import { sql } from "drizzle-orm"
import { db } from "@/db"
import { sites } from "@/db/schema"
import { formatDateInTz, startOfDayUtcMs } from "@/lib/dates"

/**
 * Daily rollup aggregation (§7). Runs once a day from the cron trigger in
 * `src/server.ts`. For each site, rolls up the just-completed day (in that
 * site's own timezone) from the raw tables into the `daily_*` tables.
 *
 * Every write is `INSERT ... ON CONFLICT DO UPDATE`, so re-running this
 * for a day that's already been aggregated (manual backfill, retry after
 * a failure) is always safe.
 */
export async function runDailyAggregation(dateOverride?: string): Promise<void> {
  const allSites = await db.select().from(sites)
  for (const site of allSites) {
    const date = dateOverride ?? previousDateInTz(site.timezone)
    await aggregateSiteDay(site.id, site.timezone, date)
  }
}

function previousDateInTz(timezone: string): string {
  const today = formatDateInTz(new Date(), timezone)
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function nextDateStr(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Rolls up a single site's single day. Exported for manual backfill. */
export async function aggregateSiteDay(
  siteId: string,
  timezone: string,
  date: string,
): Promise<void> {
  const startSec = Math.floor(startOfDayUtcMs(date, timezone) / 1000)
  const endSec = Math.floor(startOfDayUtcMs(nextDateStr(date), timezone) / 1000)

  await db.run(sql`
    INSERT INTO daily_summary (site_id, date, visitors, visits, pageviews, bounce_rate, avg_duration_seconds)
    SELECT
      ${siteId},
      ${date},
      COALESCE((SELECT COUNT(DISTINCT visitor_id) FROM visits WHERE site_id = ${siteId} AND started_at >= ${startSec} AND started_at < ${endSec}), 0),
      COALESCE((SELECT COUNT(*) FROM visits WHERE site_id = ${siteId} AND started_at >= ${startSec} AND started_at < ${endSec}), 0),
      COALESCE((SELECT COUNT(*) FROM pages WHERE site_id = ${siteId} AND timestamp >= ${startSec} AND timestamp < ${endSec}), 0),
      COALESCE((SELECT AVG(is_bounce) FROM visits WHERE site_id = ${siteId} AND started_at >= ${startSec} AND started_at < ${endSec}), 0),
      COALESCE((SELECT AVG(ended_at - started_at) FROM visits WHERE site_id = ${siteId} AND started_at >= ${startSec} AND started_at < ${endSec}), 0)
    ON CONFLICT (site_id, date) DO UPDATE SET
      visitors = excluded.visitors,
      visits = excluded.visits,
      pageviews = excluded.pageviews,
      bounce_rate = excluded.bounce_rate,
      avg_duration_seconds = excluded.avg_duration_seconds
  `)

  await db.run(sql`
    INSERT INTO daily_pages (site_id, date, path, pageviews, visitors)
    SELECT
      ${siteId},
      ${date},
      p.path,
      COUNT(*),
      COUNT(DISTINCT v.visitor_id)
    FROM pages p
    JOIN visits v ON v.id = p.visit_id
    WHERE p.site_id = ${siteId} AND p.timestamp >= ${startSec} AND p.timestamp < ${endSec}
    GROUP BY p.path
    ON CONFLICT (site_id, date, path) DO UPDATE SET
      pageviews = excluded.pageviews,
      visitors = excluded.visitors
  `)

  await db.run(sql`
    INSERT INTO daily_sources (site_id, date, referrer_domain, utm_source, utm_medium, visits)
    SELECT
      ${siteId},
      ${date},
      s.referrer_domain,
      s.utm_source,
      s.utm_medium,
      COUNT(*)
    FROM visits v
    JOIN sources s ON s.id = v.source_id
    WHERE v.site_id = ${siteId} AND v.started_at >= ${startSec} AND v.started_at < ${endSec}
    GROUP BY s.referrer_domain, s.utm_source, s.utm_medium
    ON CONFLICT (site_id, date, referrer_domain, utm_source, utm_medium) DO UPDATE SET
      visits = excluded.visits
  `)

  await db.run(sql`
    INSERT INTO daily_devices (site_id, date, device_type, browser, visits)
    SELECT
      ${siteId},
      ${date},
      d.device_type,
      d.browser,
      COUNT(*)
    FROM visits v
    JOIN devices d ON d.id = v.device_id
    WHERE v.site_id = ${siteId} AND v.started_at >= ${startSec} AND v.started_at < ${endSec}
    GROUP BY d.device_type, d.browser
    ON CONFLICT (site_id, date, device_type, browser) DO UPDATE SET
      visits = excluded.visits
  `)

  await db.run(sql`
    INSERT INTO daily_locations (site_id, date, country, city, visits)
    SELECT
      ${siteId},
      ${date},
      l.country,
      l.city,
      COUNT(*)
    FROM visits v
    JOIN locations l ON l.id = v.location_id
    WHERE v.site_id = ${siteId} AND v.started_at >= ${startSec} AND v.started_at < ${endSec}
    GROUP BY l.country, l.city
    ON CONFLICT (site_id, date, country, city) DO UPDATE SET
      visits = excluded.visits
  `)

  await db.run(sql`
    INSERT INTO daily_events (site_id, date, name, count)
    SELECT
      ${siteId},
      ${date},
      e.name,
      COUNT(*)
    FROM events e
    WHERE e.site_id = ${siteId} AND e.timestamp >= ${startSec} AND e.timestamp < ${endSec}
    GROUP BY e.name
    ON CONFLICT (site_id, date, name) DO UPDATE SET
      count = excluded.count
  `)
}
