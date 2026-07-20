import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { dailySummary, type Site } from "@/db/schema"
import { splitRangeForQuery, startOfDayUtcMs, type ResolvedRange } from "@/lib/dates"
import { computeRawStats } from "@/lib/raw-stats"

export interface TimeseriesPoint {
  date: string
  pageviews: number
  visitors: number
}

/** One point per day in range — rollup days + a final "today" raw point. */
export async function computeTimeseries(
  site: Site,
  resolved: ResolvedRange,
): Promise<TimeseriesPoint[]> {
  const { rollupDates, includesToday } = splitRangeForQuery(resolved)
  const points: TimeseriesPoint[] = []

  if (rollupDates.length > 0) {
    const rows = await db
      .select()
      .from(dailySummary)
      .where(
        and(eq(dailySummary.siteId, site.id), inArray(dailySummary.date, rollupDates)),
      )
      .orderBy(asc(dailySummary.date))
    const byDate = new Map(rows.map((r) => [r.date, r]))
    for (const date of rollupDates) {
      const r = byDate.get(date)
      points.push({ date, pageviews: r?.pageviews ?? 0, visitors: r?.visitors ?? 0 })
    }
  }

  if (includesToday) {
    const startSec = Math.floor(startOfDayUtcMs(resolved.today, site.timezone) / 1000)
    const endSec = Math.floor(Date.now() / 1000)
    const today = await computeRawStats(site.id, startSec, endSec)
    points.push({
      date: resolved.today,
      pageviews: today.pageviews,
      visitors: today.visitors,
    })
  }

  return points
}
