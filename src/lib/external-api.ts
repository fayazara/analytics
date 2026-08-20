import { env } from "cloudflare:workers"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { sites } from "@/db/schema"
import { resolveSiteAndRange } from "@/lib/api-context"
import { computeSummary } from "@/lib/summary"
import { computeTimeseries } from "@/lib/timeseries"
import {
  computeTopDevices,
  computeTopEvents,
  computeTopLocations,
  computeTopPages,
  computeTopSources,
  type DeviceDimension,
  type LocationDimension,
  type PageDimension,
  type SourceDimension,
} from "@/lib/top-lists"

/**
 * `/ext/v1/*` — read-only external API.
 *
 * Why this exists separately from `/api/*`:
 *
 * `/api/*` is meant to sit behind Cloudflare Access (README §10), which
 * authenticates a *browser* via cookie. An external client like the TAP
 * miniapp can't complete an interactive Access login, so it needs a path
 * that Access bypasses and that carries its own credential instead.
 *
 * So the split is deliberate:
 *
 *   /api/*     Access-protected, read+write, first-party dashboard.
 *   /ext/v1/*  bearer-token, READ-ONLY, external clients.
 *
 * Read-only is the useful security property here: leaking the token
 * exposes analytics data but can never create or delete a site.
 *
 * Deploy notes:
 *   wrangler secret put ANALYTICS_API_TOKEN
 *   ...then add a Cloudflare Access bypass policy for /ext/v1/*
 */

const PREFIX = "/ext/v1"

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      // Analytics responses are per-request and token-scoped; never let a
      // proxy or browser retain them.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // Advertise the scheme so clients fail loudly rather than silently
      // retrying without credentials.
      "WWW-Authenticate": 'Bearer realm="web-analytics"',
    },
  })
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  )
  return new Uint8Array(digest)
}

/**
 * Constant-time compare over SHA-256 digests.
 *
 * Hashing first means the comparison is always over 32 fixed bytes, so
 * neither the token's length nor its content leaks through timing.
 */
async function tokenMatches(
  presented: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization")
  if (!header) return null
  // Scheme is case-insensitive per RFC 7235.
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim())
  return match ? match[1]!.trim() : null
}

/**
 * Resolves `?view=` against the allowed dimensions for a resource,
 * falling back to that resource's default rather than erroring — this
 * mirrors the behaviour of the `/api/*` routes.
 */
function pickView<T extends string>(
  request: Request,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  const view = new URL(request.url).searchParams.get("view")
  return allowed.includes(view as T) ? (view as T) : fallback
}

/**
 * Handles a `/ext/v1/*` request, or returns `null` when the path isn't
 * ours so the caller can fall through to the app handler.
 */
export async function handleExternalApi(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
    return null
  }

  // --- auth ---------------------------------------------------------------

  const expected = env.ANALYTICS_API_TOKEN
  if (!expected) {
    // Fail closed. An unset token means "this API is switched off", not
    // "let everyone in".
    return json(
      {
        error:
          "External API is not configured. Set the ANALYTICS_API_TOKEN secret to enable /ext/v1.",
      },
      503,
    )
  }

  const presented = bearerToken(request)
  if (!presented) return unauthorized("Missing Bearer token")
  if (!(await tokenMatches(presented, expected))) {
    return unauthorized("Invalid Bearer token")
  }

  // --- method -------------------------------------------------------------

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "GET, HEAD, OPTIONS" },
    })
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "This API is read-only" }, 405)
  }

  // --- routing ------------------------------------------------------------

  const segments = url.pathname.slice(PREFIX.length).split("/").filter(Boolean)

  // GET /ext/v1/meta
  if (segments.length === 1 && segments[0] === "meta") {
    return json({
      trackerOrigin: new URL(env.TRACKER_ORIGIN).origin,
      apiVersion: 1,
      readOnly: true,
    })
  }

  if (segments[0] !== "sites") {
    return json({ error: "Not found" }, 404)
  }

  // GET /ext/v1/sites
  if (segments.length === 1) {
    const rows = await db.select().from(sites).orderBy(asc(sites.name))
    return json({ sites: rows })
  }

  const siteId = segments[1]!

  // GET /ext/v1/sites/:siteId
  if (segments.length === 2) {
    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
    if (!site) return json({ error: "Site not found" }, 404)
    return json(site)
  }

  if (segments.length !== 3) return json({ error: "Not found" }, 404)

  const resource = segments[2]!

  // Realtime is resolved straight from the Durable Object and doesn't need
  // a date range, so it's handled before range resolution.
  if (resource === "realtime") {
    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
    if (!site) return json({ error: "Site not found" }, 404)

    const count = await env.LIVE_VISITORS.getByName(siteId).count()
    return json({ count })
  }

  const ctx = await resolveSiteAndRange(request, siteId)
  if (!ctx) return json({ error: "Site not found" }, 404)

  switch (resource) {
    case "summary": {
      const summary = await computeSummary(ctx.site, ctx.resolved)
      return json({ range: ctx.resolved, ...summary })
    }

    case "timeseries": {
      const points = await computeTimeseries(ctx.site, ctx.resolved)
      return json({ range: ctx.resolved, points })
    }

    case "pages": {
      const view = pickView<PageDimension>(
        request,
        ["top", "entered", "exited"],
        "top",
      )
      const result = await computeTopPages(ctx.site, ctx.resolved, view)
      return json({ range: ctx.resolved, view, ...result })
    }

    case "sources": {
      const view = pickView<SourceDimension>(
        request,
        ["referrer", "links", "utm"],
        "referrer",
      )
      const result = await computeTopSources(ctx.site, ctx.resolved, view)
      return json({ range: ctx.resolved, view, ...result })
    }

    case "devices": {
      const view = pickView<DeviceDimension>(
        request,
        ["browser", "os", "device"],
        "browser",
      )
      const result = await computeTopDevices(ctx.site, ctx.resolved, view)
      return json({ range: ctx.resolved, view, ...result })
    }

    case "locations": {
      const view = pickView<LocationDimension>(
        request,
        ["country", "region", "city"],
        "country",
      )
      const result = await computeTopLocations(ctx.site, ctx.resolved, view)
      return json({ range: ctx.resolved, view, ...result })
    }

    case "activity": {
      const rows = await computeTopEvents(ctx.site, ctx.resolved)
      return json({ range: ctx.resolved, rows })
    }

    default:
      return json({ error: "Not found" }, 404)
  }
}
