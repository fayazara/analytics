import { and, eq, gte, lte } from "drizzle-orm"
import { db } from "@/db"
import { dailySummary, type Site } from "@/db/schema"
import { splitRangeForQuery, startOfDayUtcMs, type ResolvedRange } from "@/lib/dates"
import { computeRawStats } from "@/lib/raw-stats"

export interface SummaryResult {
  visitors: number
  visits: number
  pageviews: number
  bounceRate: number
  avgDurationSeconds: number
}

/**
 * Combines `daily_summary` rollup rows with a raw-table query for "today"
 * (§8). Note: `visitors` for multi-day ranges is the *sum* of each day's
 * distinct-visitor count, which is a slight over-count for people who
 * visit on more than one day in the range — the `daily_summary` rollup
 * (§5) only stores a per-day distinct count, not a per-range one, so this
 * is the best available from that schema without scanning raw visits for
 * historical days (which §8 explicitly rules out).
 */
export async function computeSummary(
  site: Site,
  resolved: ResolvedRange,
): Promise<SummaryResult> {
  const { rollupBounds, includesToday } = splitRangeForQuery(resolved)

  let visitors = 0
  let visitsTotal = 0
  let pageviewsTotal = 0
  let bounceWeighted = 0
  let durationWeighted = 0

  // The rollup query and the "today" raw query don't depend on each
  // other — fire both at once instead of paying for two sequential D1
  // round-trips.
  const [rollupRows, today] = await Promise.all([
    rollupBounds
      ? db
          .select()
          .from(dailySummary)
          .where(
            and(
              eq(dailySummary.siteId, site.id),
              gte(dailySummary.date, rollupBounds.from),
              lte(dailySummary.date, rollupBounds.to),
            ),
          )
      : Promise.resolve([]),
    includesToday
      ? computeRawStats(
          site.id,
          Math.floor(startOfDayUtcMs(resolved.today, site.timezone) / 1000),
          Math.floor(Date.now() / 1000),
        )
      : Promise.resolve(null),
  ])

  for (const r of rollupRows) {
    visitors += r.visitors
    visitsTotal += r.visits
    pageviewsTotal += r.pageviews
    bounceWeighted += r.bounceRate * r.visits
    durationWeighted += r.avgDurationSeconds * r.visits
  }

  if (today) {
    visitors += today.visitors
    visitsTotal += today.visits
    pageviewsTotal += today.pageviews
    bounceWeighted += today.bounceRate * today.visits
    durationWeighted += today.avgDurationSeconds * today.visits
  }

  return {
    visitors,
    visits: visitsTotal,
    pageviews: pageviewsTotal,
    bounceRate: visitsTotal > 0 ? bounceWeighted / visitsTotal : 0,
    avgDurationSeconds: visitsTotal > 0 ? durationWeighted / visitsTotal : 0,
  }
}
