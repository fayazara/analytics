import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import { dailySummary, pages, type Site, visits } from "@/db/schema"
import { splitRangeForQuery, startOfDayUtcMs, type ResolvedRange } from "@/lib/dates"
import { computeRawStats } from "@/lib/raw-stats"

export interface TimeseriesPoint {
  /** UTC epoch ms — always a concrete instant, never just a date string. */
  timestamp: number
  pageviews: number
  visitors: number
}

/**
 * One point per day for multi-day ranges (rollup days + a final "today"
 * raw point). For the single-day "today" range there's only one rollup
 * row possible (rollups are daily-granularity by design, §7) — a line
 * chart with one point is just a dot, so that case buckets the raw
 * tables by hour instead.
 */
export async function computeTimeseries(
  site: Site,
  resolved: ResolvedRange,
): Promise<TimeseriesPoint[]> {
  const isSingleToday =
    resolved.fromDate === resolved.today && resolved.toDate === resolved.today

  if (isSingleToday) {
    return computeHourlyPoints(site, resolved.today)
  }

  const { rollupDates, rollupBounds, includesToday } = splitRangeForQuery(resolved)
  const points: TimeseriesPoint[] = []

  if (rollupBounds) {
    const rows = await db
      .select()
      .from(dailySummary)
      .where(
        and(
          eq(dailySummary.siteId, site.id),
          gte(dailySummary.date, rollupBounds.from),
          lte(dailySummary.date, rollupBounds.to),
        ),
      )
      .orderBy(asc(dailySummary.date))
    const byDate = new Map(rows.map((r) => [r.date, r]))
    for (const date of rollupDates) {
      const r = byDate.get(date)
      points.push({
        timestamp: startOfDayUtcMs(date, site.timezone),
        pageviews: r?.pageviews ?? 0,
        visitors: r?.visitors ?? 0,
      })
    }
  }

  if (includesToday) {
    const todayStart = startOfDayUtcMs(resolved.today, site.timezone)
    const startSec = Math.floor(todayStart / 1000)
    const endSec = Math.floor(Date.now() / 1000)
    const today = await computeRawStats(site.id, startSec, endSec)
    points.push({
      timestamp: todayStart,
      pageviews: today.pageviews,
      visitors: today.visitors,
    })
  }

  return points
}

/** Hourly buckets from raw `pages`/`visits` for "today" only (§8). */
async function computeHourlyPoints(
  site: Site,
  todayStr: string,
): Promise<TimeseriesPoint[]> {
  const dayStartSec = Math.floor(startOfDayUtcMs(todayStr, site.timezone) / 1000)
  const nowSec = Math.floor(Date.now() / 1000)
  const currentHour = Math.min(23, Math.floor((nowSec - dayStartSec) / 3600))

  const pageBucket = sql<number>`CAST((${pages.timestamp} - ${dayStartSec}) / 3600 AS INTEGER)`
  const pageRows = await db
    .select({ bucket: pageBucket, pageviews: sql<number>`COUNT(*)` })
    .from(pages)
    .where(
      and(eq(pages.siteId, site.id), gte(pages.timestamp, dayStartSec), lt(pages.timestamp, nowSec + 1)),
    )
    .groupBy(pageBucket)

  const visitBucket = sql<number>`CAST((${visits.startedAt} - ${dayStartSec}) / 3600 AS INTEGER)`
  const visitRows = await db
    .select({ bucket: visitBucket, visitors: sql<number>`COUNT(DISTINCT ${visits.visitorId})` })
    .from(visits)
    .where(
      and(eq(visits.siteId, site.id), gte(visits.startedAt, dayStartSec), lt(visits.startedAt, nowSec + 1)),
    )
    .groupBy(visitBucket)

  const pageviewsByHour = new Map(pageRows.map((r) => [Number(r.bucket), Number(r.pageviews)]))
  const visitorsByHour = new Map(visitRows.map((r) => [Number(r.bucket), Number(r.visitors)]))

  const points: TimeseriesPoint[] = []
  for (let hour = 0; hour <= currentHour; hour++) {
    points.push({
      timestamp: (dayStartSec + hour * 3600) * 1000,
      pageviews: pageviewsByHour.get(hour) ?? 0,
      visitors: visitorsByHour.get(hour) ?? 0,
    })
  }
  return points
}
