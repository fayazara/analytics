import { createFileRoute } from "@tanstack/react-router"
import { env, waitUntil } from "cloudflare:workers"
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { events, pages, sites, visitors, visits } from "@/db/schema"
import {
  type CollectRequest,
  collectRequestSchema,
} from "@/lib/collect-schema"
import { extractGeo, type GeoInfo } from "@/lib/geo"
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
            processCollectRequest(parsed.data, { ip, userAgent, geo, now }),
          )
        }

        // Always 204, even on validation failure — never surface an
        // ingestion error to a visitor's browser.
        return new Response(null, { status: 204, headers: CORS_HEADERS })
      },

      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
    },
  },
})

async function readBody(request: Request): Promise<unknown> {
  // `navigator.sendBeacon` sends `Content-Type: text/plain`, so we read as
  // text and parse ourselves rather than relying on `request.json()`.
  try {
    const text = await request.text()
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
  ctx: CollectContext,
): Promise<void> {
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.id, data.site_id))
    .limit(1)
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

  if (data.name) {
    await handleEvent(site.id, visitorId, data, nowSec)
  } else if (data.path) {
    await handlePageview(site, visitorId, data, ctx, nowSec)
  }
}

async function handlePageview(
  site: typeof sites.$inferSelect,
  visitorId: string,
  data: CollectRequest,
  ctx: CollectContext,
  nowSec: number,
): Promise<void> {
  if (!data.path) return

  const parsedUa = parseUserAgent(ctx.userAgent)
  const referrer = parseReferrer(data.referrer ?? null, site.domain)

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
  waitUntil(stub.ping(visitorId).then(() => undefined, () => undefined))
}

async function handleEvent(
  siteId: string,
  visitorId: string,
  data: CollectRequest,
  nowSec: number,
): Promise<void> {
  if (!data.name) return

  // Custom events attach to the visitor's current visit. If there isn't
  // one yet (e.g. an event fires before any pageview), drop it — events
  // are meaningless without a visit context.
  const [visit] = await db
    .select({ id: visits.id })
    .from(visits)
    .where(eq(visits.visitorId, visitorId))
    .orderBy(desc(visits.startedAt))
    .limit(1)
  if (!visit) return

  await db.insert(events).values({
    siteId,
    visitId: visit.id,
    name: data.name,
    props: data.props ? JSON.stringify(data.props) : null,
    timestamp: nowSec,
  })
}
