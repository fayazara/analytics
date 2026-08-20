import { createFileRoute } from "@tanstack/react-router"
import { env, waitUntil } from "cloudflare:workers"
import { desc, eq } from "drizzle-orm"
import type { CollectRequest } from "@/lib/collect-schema"
import type { GeoInfo } from "@/lib/geo"
import { db } from "@/db"
import {
  events,
  outboundLinks,
  pages,
  sites,
  visitors,
  visits,
} from "@/db/schema"
import { collectRequestSchema } from "@/lib/collect-schema"
import { extractGeo } from "@/lib/geo"
import {
  parseReferrer,
  resolveDeviceId,
  resolveLocationId,
  resolveSourceId,
} from "@/lib/lookups"
import { upsertVisit } from "@/lib/session"
import { parseUserAgent } from "@/lib/ua"
import { computeVisitorId } from "@/lib/visitor-id"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

const MAX_COLLECT_BODY_BYTES = 16 * 1024

/**
 * `POST /collect` — the only public route (§8, §10). Called by the
 * tracking snippet (`public/script.js`) via `fetch`/`sendBeacon`.
 *
 * Always responds `204` immediately; all D1 writes and the LiveVisitors
 * ping happen in the background via `waitUntil` so the visitor's browser
 * never waits on them (§6).
 */
export const Route = createFileRoute("/collect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await readBody(request)
        const parsed = collectRequestSchema.safeParse(raw)

        if (parsed.success) {
          const ip = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0"
          const userAgent = request.headers.get("User-Agent") ?? ""
          const geo = extractGeo(request)
          const now = Date.now()

          waitUntil(
            processCollectRequest(parsed.data, { ip, userAgent, geo, now })
          )
        }

        // Always 204, even on validation failure — never surface an
        // ingestion error to a visitor's browser.
        return new Response(null, { status: 204, headers: CORS_HEADERS })
      },

      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
    },
  },
})

async function readBody(request: Request): Promise<unknown> {
  // `navigator.sendBeacon` sends `Content-Type: text/plain`, so we read as
  // text and parse ourselves rather than relying on `request.json()`.
  try {
    const contentLength = request.headers.get("Content-Length")
    if (contentLength && Number(contentLength) > MAX_COLLECT_BODY_BYTES) {
      return null
    }

    if (!request.body) return null

    const reader = request.body.getReader()
    const decoder = new TextDecoder()
    let totalBytes = 0
    let text = ""

    let chunk = await reader.read()
    while (!chunk.done) {
      const { value } = chunk
      totalBytes += value.byteLength
      if (totalBytes > MAX_COLLECT_BODY_BYTES) {
        await reader.cancel()
        return null
      }

      text += decoder.decode(value, { stream: true })
      chunk = await reader.read()
    }

    text += decoder.decode()
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

interface CollectContext {
  ip: string
  userAgent: string
  geo: GeoInfo
  now: number
}

async function processCollectRequest(
  data: CollectRequest,
  ctx: CollectContext
): Promise<void> {
  const site = await db
    .select()
    .from(sites)
    .where(eq(sites.id, data.site_id))
    .limit(1)
    .get()
  if (!site) return // unknown site_id — drop silently

  const visitorId = await computeVisitorId(site.id, ctx.ip, ctx.userAgent)
  const nowSec = Math.floor(ctx.now / 1000)

  await db
    .insert(visitors)
    .values({
      id: visitorId,
      siteId: site.id,
      firstSeen: nowSec,
      lastSeen: nowSec,
    })
    .onConflictDoUpdate({ target: visitors.id, set: { lastSeen: nowSec } })

  if (data.outbound_url) {
    await handleOutboundLink(site, visitorId, data.outbound_url, nowSec)
  } else if (data.name) {
    await handleEvent(site.id, visitorId, data, nowSec)
  } else if (data.path) {
    await handlePageview(site, visitorId, data, ctx, nowSec)
  }
}

async function handleOutboundLink(
  site: typeof sites.$inferSelect,
  visitorId: string,
  value: string,
  nowSec: number
): Promise<void> {
  const url = normalizeOutboundUrl(value, site.domain)
  if (!url) return

  await db.insert(outboundLinks).values({
    siteId: site.id,
    visitorId,
    url,
    timestamp: nowSec,
  })
}

function normalizeOutboundUrl(
  value: string,
  siteDomain: string
): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null

    const siteUrl = new URL(
      siteDomain.includes("://") ? siteDomain : `https://${siteDomain}`
    )
    if (
      url.hostname.replace(/^www\./, "") ===
      siteUrl.hostname.replace(/^www\./, "")
    ) {
      return null
    }

    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

async function handlePageview(
  site: typeof sites.$inferSelect,
  visitorId: string,
  data: CollectRequest,
  ctx: CollectContext,
  nowSec: number
): Promise<void> {
  if (!data.path) return

  const parsedUa = parseUserAgent(ctx.userAgent)
  const referrer = parseReferrer(data.referrer ?? null, site.domain, {
    utmSource: data.utm_source,
    utmMedium: data.utm_medium,
    utmCampaign: data.utm_campaign,
  })

  const [sourceId, deviceId, locationId] = await Promise.all([
    resolveSourceId(site.id, referrer),
    resolveDeviceId(parsedUa),
    resolveLocationId(ctx.geo),
  ])

  const { visitId } = await upsertVisit({
    siteId: site.id,
    visitorId,
    path: data.path,
    timestampMs: ctx.now,
    sourceId,
    deviceId,
    locationId,
  })

  await db.insert(pages).values({
    siteId: site.id,
    visitId,
    path: data.path,
    title: data.title ?? null,
    timestamp: nowSec,
  })

  // Fire-and-forget ping to the site's LiveVisitors DO (§11). Never let a
  // DO hiccup affect ingestion.
  const stub = env.LIVE_VISITORS.getByName(site.id)
  const realtimeLocation =
    ctx.geo.latitude !== null && ctx.geo.longitude !== null
      ? {
          latitude: ctx.geo.latitude,
          longitude: ctx.geo.longitude,
        }
      : undefined
  waitUntil(
    stub.ping(visitorId, realtimeLocation).then(
      () => undefined,
      () => undefined
    )
  )
}

async function handleEvent(
  siteId: string,
  visitorId: string,
  data: CollectRequest,
  nowSec: number
): Promise<void> {
  if (!data.name) return

  // Custom events attach to the visitor's current visit. If there isn't
  // one yet (e.g. an event fires before any pageview), drop it — events
  // are meaningless without a visit context.
  const visit = await db
    .select({ id: visits.id })
    .from(visits)
    .where(eq(visits.visitorId, visitorId))
    .orderBy(desc(visits.startedAt))
    .limit(1)
    .get()
  if (!visit) return

  await db.insert(events).values({
    siteId,
    visitId: visit.id,
    name: data.name,
    props: data.props ? JSON.stringify(data.props) : null,
    timestamp: nowSec,
  })
}
