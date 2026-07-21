import { and, eq, gte, lt, sql } from "drizzle-orm"
import { db } from "@/db"
import { pages, visits } from "@/db/schema"

/**
 * Aggregates raw (un-rolled-up) rows for "today" — the only slice the
 * dashboard is allowed to read from raw tables (§8).
 */
export interface RawDayStats {
  visitors: number
  visits: number
  pageviews: number
  bounceRate: number
  avgDurationSeconds: number
}

export async function computeRawStats(
  siteId: string,
  startSec: number,
  endSec: number,
): Promise<RawDayStats> {
  // Independent queries — fire together. Each D1 round-trip has real
  // cost (esp. cross-region), so awaiting them one at a time here would
  // double the latency for no reason.
  const [[visitRow], [pageRow]] = await Promise.all([
    db
      .select({
        visitors: sql<number>`COUNT(DISTINCT ${visits.visitorId})`,
        visits: sql<number>`COUNT(*)`,
        bounceRate: sql<number>`COALESCE(AVG(${visits.isBounce}), 0)`,
        avgDuration: sql<number>`COALESCE(AVG(${visits.endedAt} - ${visits.startedAt}), 0)`,
      })
      .from(visits)
      .where(
        and(
          eq(visits.siteId, siteId),
          gte(visits.startedAt, startSec),
          lt(visits.startedAt, endSec),
        ),
      ),
    db
      .select({ pageviews: sql<number>`COUNT(*)` })
      .from(pages)
      .where(
        and(
          eq(pages.siteId, siteId),
          gte(pages.timestamp, startSec),
          lt(pages.timestamp, endSec),
        ),
      ),
  ])

  return {
    visitors: Number(visitRow?.visitors ?? 0),
    visits: Number(visitRow?.visits ?? 0),
    pageviews: Number(pageRow?.pageviews ?? 0),
    bounceRate: Number(visitRow?.bounceRate ?? 0),
    avgDurationSeconds: Number(visitRow?.avgDuration ?? 0),
  }
}
