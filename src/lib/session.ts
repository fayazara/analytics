import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { visits } from "@/db/schema"

/** 30-minute session window (§4). */
const SESSION_WINDOW_MS = 30 * 60 * 1000

export interface UpsertVisitParams {
  siteId: string
  visitorId: string
  path: string
  timestampMs: number
  sourceId: number | null
  deviceId: number | null
  locationId: number | null
}

export interface UpsertVisitResult {
  visitId: string
  isNewVisit: boolean
}

/**
 * Find the visitor's most recent visit. If it *started* less than 30
 * minutes ago, append this pageview to it. Otherwise start a new visit
 * row. See §4 — this is intentionally keyed off `started_at`, not the
 * time since the last pageview.
 */
export async function upsertVisit(
  params: UpsertVisitParams,
): Promise<UpsertVisitResult> {
  const { siteId, visitorId, path, timestampMs, sourceId, deviceId, locationId } =
    params
  const nowSec = Math.floor(timestampMs / 1000)

  const [existing] = await db
    .select()
    .from(visits)
    .where(eq(visits.visitorId, visitorId))
    .orderBy(desc(visits.startedAt))
    .limit(1)

  if (existing && timestampMs - existing.startedAt * 1000 < SESSION_WINDOW_MS) {
    await db
      .update(visits)
      .set({
        endedAt: nowSec,
        exitPage: path,
        pageCount: existing.pageCount + 1,
        isBounce: false,
      })
      .where(eq(visits.id, existing.id))
    return { visitId: existing.id, isNewVisit: false }
  }

  const id = crypto.randomUUID()
  await db.insert(visits).values({
    id,
    siteId,
    visitorId,
    startedAt: nowSec,
    endedAt: nowSec,
    entryPage: path,
    exitPage: path,
    pageCount: 1,
    isBounce: true,
    sourceId: sourceId ?? undefined,
    deviceId: deviceId ?? undefined,
    locationId: locationId ?? undefined,
  })
  return { visitId: id, isNewVisit: true }
}
