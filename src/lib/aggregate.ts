import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { dailyDevices, dailyLocations, dailySources, sites } from "@/db/schema"
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
export async function runDailyAggregation(
  dateOverride?: string
): Promise<void> {
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
  date: string
): Promise<void> {
  const startSec = Math.floor(startOfDayUtcMs(date, timezone) / 1000)
  const endSec = Math.floor(startOfDayUtcMs(nextDateStr(date), timezone) / 1000)

  // These rollups gained additional dimensions after launch. Replacing the
  // day's rows avoids retaining legacy partially-grouped rows alongside the
  // new, more specific groups when a day is re-aggregated.
  await db
    .delete(dailySources)
    .where(and(eq(dailySources.siteId, siteId), eq(dailySources.date, date)))
  await db
    .delete(dailyDevices)
    .where(and(eq(dailyDevices.siteId, siteId), eq(dailyDevices.date, date)))
  await db
    .delete(dailyLocations)
    .where(
      and(eq(dailyLocations.siteId, siteId), eq(dailyLocations.date, date))
    )

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
    INSERT INTO daily_pages (site_id, date, path, pageviews, visitors, entrances, exits)
    SELECT
      ${siteId},
      ${date},
      p.path,
      COUNT(*),
      COUNT(DISTINCT v.visitor_id),
      COUNT(DISTINCT CASE WHEN v.entry_page = p.path THEN v.id END),
      COUNT(DISTINCT CASE WHEN v.exit_page = p.path THEN v.id END)
    FROM pages p
    JOIN visits v ON v.id = p.visit_id
    WHERE p.site_id = ${siteId} AND p.timestamp >= ${startSec} AND p.timestamp < ${endSec}
    GROUP BY p.path
    ON CONFLICT (site_id, date, path) DO UPDATE SET
      pageviews = excluded.pageviews,
      visitors = excluded.visitors,
      entrances = excluded.entrances,
      exits = excluded.exits
  `)

  await db.run(sql`
    INSERT INTO daily_sources (site_id, date, referrer_domain, utm_source, utm_medium, utm_campaign, visits)
    SELECT
      ${siteId},
      ${date},
      s.referrer_domain,
      COALESCE(s.utm_source, ''),
      COALESCE(s.utm_medium, ''),
      COALESCE(s.utm_campaign, ''),
      COUNT(*)
    FROM visits v
    JOIN sources s ON s.id = v.source_id
    WHERE v.site_id = ${siteId} AND v.started_at >= ${startSec} AND v.started_at < ${endSec}
    GROUP BY
      s.referrer_domain,
      COALESCE(s.utm_source, ''),
      COALESCE(s.utm_medium, ''),
      COALESCE(s.utm_campaign, '')
    ON CONFLICT (site_id, date, referrer_domain, utm_source, utm_medium, utm_campaign) DO UPDATE SET
      visits = excluded.visits
  `)

  await db.run(sql`
    INSERT INTO daily_devices (site_id, date, device_type, browser, os, visits)
    SELECT
      ${siteId},
      ${date},
      d.device_type,
      d.browser,
      d.os,
      COUNT(*)
    FROM visits v
    JOIN devices d ON d.id = v.device_id
    WHERE v.site_id = ${siteId} AND v.started_at >= ${startSec} AND v.started_at < ${endSec}
    GROUP BY d.device_type, d.browser, d.os
    ON CONFLICT (site_id, date, device_type, browser, os) DO UPDATE SET
      visits = excluded.visits
  `)

  await db.run(sql`
    INSERT INTO daily_locations (site_id, date, country, region, city, visits)
    SELECT
      ${siteId},
      ${date},
      l.country,
      COALESCE(l.region, ''),
      COALESCE(l.city, ''),
      COUNT(*)
    FROM visits v
    JOIN locations l ON l.id = v.location_id
    WHERE v.site_id = ${siteId} AND v.started_at >= ${startSec} AND v.started_at < ${endSec}
    GROUP BY l.country, COALESCE(l.region, ''), COALESCE(l.city, '')
    ON CONFLICT (site_id, date, country, region, city) DO UPDATE SET
      visits = excluded.visits
  `)

  await db.run(sql`
    INSERT INTO daily_outbound_links (site_id, date, url, clicks)
    SELECT
      ${siteId},
      ${date},
      o.url,
      COUNT(*)
    FROM outbound_links o
    WHERE o.site_id = ${siteId} AND o.timestamp >= ${startSec} AND o.timestamp < ${endSec}
    GROUP BY o.url
    ON CONFLICT (site_id, date, url) DO UPDATE SET
      clicks = excluded.clicks
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
