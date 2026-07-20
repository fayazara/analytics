import { and, eq, gte, inArray, lt, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  dailyDevices,
  dailyEvents,
  dailyLocations,
  dailyPages,
  dailySources,
  devices,
  events,
  locations,
  pages,
  type Site,
  sources,
  visits,
} from "@/db/schema"
import { splitRangeForQuery, startOfDayUtcMs, type ResolvedRange } from "@/lib/dates"

function todayBounds(site: Site, resolved: ResolvedRange) {
  return {
    startSec: Math.floor(startOfDayUtcMs(resolved.today, site.timezone) / 1000),
    endSec: Math.floor(Date.now() / 1000),
  }
}

// ---------------------------------------------------------------------------
// Top pages
// ---------------------------------------------------------------------------

export interface TopPageRow {
  path: string
  pageviews: number
  visitors: number
}

export async function computeTopPages(
  site: Site,
  resolved: ResolvedRange,
  limit = 10,
): Promise<TopPageRow[]> {
  const { rollupDates, includesToday } = splitRangeForQuery(resolved)
  const merged = new Map<string, TopPageRow>()

  if (rollupDates.length > 0) {
    const rows = await db
      .select({
        path: dailyPages.path,
        pageviews: sql<number>`SUM(${dailyPages.pageviews})`,
        visitors: sql<number>`SUM(${dailyPages.visitors})`,
      })
      .from(dailyPages)
      .where(and(eq(dailyPages.siteId, site.id), inArray(dailyPages.date, rollupDates)))
      .groupBy(dailyPages.path)
    for (const r of rows) {
      merged.set(r.path, {
        path: r.path,
        pageviews: Number(r.pageviews),
        visitors: Number(r.visitors),
      })
    }
  }

  if (includesToday) {
    const { startSec, endSec } = todayBounds(site, resolved)
    const rows = await db
      .select({
        path: pages.path,
        pageviews: sql<number>`COUNT(*)`,
        visitors: sql<number>`COUNT(DISTINCT ${visits.visitorId})`,
      })
      .from(pages)
      .innerJoin(visits, eq(visits.id, pages.visitId))
      .where(
        and(eq(pages.siteId, site.id), gte(pages.timestamp, startSec), lt(pages.timestamp, endSec)),
      )
      .groupBy(pages.path)
    for (const r of rows) {
      const existing = merged.get(r.path)
      merged.set(r.path, {
        path: r.path,
        pageviews: (existing?.pageviews ?? 0) + Number(r.pageviews),
        visitors: (existing?.visitors ?? 0) + Number(r.visitors),
      })
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Top sources
// ---------------------------------------------------------------------------

export interface TopSourceRow {
  referrerDomain: string
  utmSource: string
  utmMedium: string
  visits: number
}

export async function computeTopSources(
  site: Site,
  resolved: ResolvedRange,
  limit = 10,
): Promise<TopSourceRow[]> {
  const { rollupDates, includesToday } = splitRangeForQuery(resolved)
  const merged = new Map<string, TopSourceRow>()
  const key = (r: string, s: string, m: string) => `${r}\u0000${s}\u0000${m}`

  if (rollupDates.length > 0) {
    const rows = await db
      .select({
        referrerDomain: dailySources.referrerDomain,
        utmSource: dailySources.utmSource,
        utmMedium: dailySources.utmMedium,
        visits: sql<number>`SUM(${dailySources.visits})`,
      })
      .from(dailySources)
      .where(
        and(eq(dailySources.siteId, site.id), inArray(dailySources.date, rollupDates)),
      )
      .groupBy(dailySources.referrerDomain, dailySources.utmSource, dailySources.utmMedium)
    for (const r of rows) {
      const utmSource = r.utmSource ?? ""
      const utmMedium = r.utmMedium ?? ""
      merged.set(key(r.referrerDomain, utmSource, utmMedium), {
        referrerDomain: r.referrerDomain,
        utmSource,
        utmMedium,
        visits: Number(r.visits),
      })
    }
  }

  if (includesToday) {
    const { startSec, endSec } = todayBounds(site, resolved)
    const rows = await db
      .select({
        referrerDomain: sources.referrerDomain,
        utmSource: sources.utmSource,
        utmMedium: sources.utmMedium,
        visits: sql<number>`COUNT(*)`,
      })
      .from(visits)
      .innerJoin(sources, eq(sources.id, visits.sourceId))
      .where(
        and(eq(visits.siteId, site.id), gte(visits.startedAt, startSec), lt(visits.startedAt, endSec)),
      )
      .groupBy(sources.referrerDomain, sources.utmSource, sources.utmMedium)
    for (const r of rows) {
      const utmSource = r.utmSource ?? ""
      const utmMedium = r.utmMedium ?? ""
      const k = key(r.referrerDomain, utmSource, utmMedium)
      const existing = merged.get(k)
      merged.set(k, {
        referrerDomain: r.referrerDomain,
        utmSource,
        utmMedium,
        visits: (existing?.visits ?? 0) + Number(r.visits),
      })
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Top devices
// ---------------------------------------------------------------------------

export interface TopDeviceRow {
  deviceType: string
  browser: string
  visits: number
}

export async function computeTopDevices(
  site: Site,
  resolved: ResolvedRange,
  limit = 10,
): Promise<TopDeviceRow[]> {
  const { rollupDates, includesToday } = splitRangeForQuery(resolved)
  const merged = new Map<string, TopDeviceRow>()
  const key = (t: string, b: string) => `${t}\u0000${b}`

  if (rollupDates.length > 0) {
    const rows = await db
      .select({
        deviceType: dailyDevices.deviceType,
        browser: dailyDevices.browser,
        visits: sql<number>`SUM(${dailyDevices.visits})`,
      })
      .from(dailyDevices)
      .where(
        and(eq(dailyDevices.siteId, site.id), inArray(dailyDevices.date, rollupDates)),
      )
      .groupBy(dailyDevices.deviceType, dailyDevices.browser)
    for (const r of rows) {
      merged.set(key(r.deviceType, r.browser), {
        deviceType: r.deviceType,
        browser: r.browser,
        visits: Number(r.visits),
      })
    }
  }

  if (includesToday) {
    const { startSec, endSec } = todayBounds(site, resolved)
    const rows = await db
      .select({
        deviceType: devices.deviceType,
        browser: devices.browser,
        visits: sql<number>`COUNT(*)`,
      })
      .from(visits)
      .innerJoin(devices, eq(devices.id, visits.deviceId))
      .where(
        and(eq(visits.siteId, site.id), gte(visits.startedAt, startSec), lt(visits.startedAt, endSec)),
      )
      .groupBy(devices.deviceType, devices.browser)
    for (const r of rows) {
      const k = key(r.deviceType, r.browser)
      const existing = merged.get(k)
      merged.set(k, {
        deviceType: r.deviceType,
        browser: r.browser,
        visits: (existing?.visits ?? 0) + Number(r.visits),
      })
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Top locations
// ---------------------------------------------------------------------------

export interface TopLocationRow {
  country: string
  city: string
  visits: number
}

export async function computeTopLocations(
  site: Site,
  resolved: ResolvedRange,
  limit = 10,
): Promise<TopLocationRow[]> {
  const { rollupDates, includesToday } = splitRangeForQuery(resolved)
  const merged = new Map<string, TopLocationRow>()
  const key = (c: string, city: string) => `${c}\u0000${city}`

  if (rollupDates.length > 0) {
    const rows = await db
      .select({
        country: dailyLocations.country,
        city: dailyLocations.city,
        visits: sql<number>`SUM(${dailyLocations.visits})`,
      })
      .from(dailyLocations)
      .where(
        and(eq(dailyLocations.siteId, site.id), inArray(dailyLocations.date, rollupDates)),
      )
      .groupBy(dailyLocations.country, dailyLocations.city)
    for (const r of rows) {
      const city = r.city ?? ""
      merged.set(key(r.country, city), {
        country: r.country,
        city,
        visits: Number(r.visits),
      })
    }
  }

  if (includesToday) {
    const { startSec, endSec } = todayBounds(site, resolved)
    const rows = await db
      .select({
        country: locations.country,
        city: locations.city,
        visits: sql<number>`COUNT(*)`,
      })
      .from(visits)
      .innerJoin(locations, eq(locations.id, visits.locationId))
      .where(
        and(eq(visits.siteId, site.id), gte(visits.startedAt, startSec), lt(visits.startedAt, endSec)),
      )
      .groupBy(locations.country, locations.city)
    for (const r of rows) {
      const city = r.city ?? ""
      const k = key(r.country, city)
      const existing = merged.get(k)
      merged.set(k, {
        country: r.country,
        city,
        visits: (existing?.visits ?? 0) + Number(r.visits),
      })
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Top custom events
// ---------------------------------------------------------------------------

export interface TopEventRow {
  name: string
  count: number
}

export async function computeTopEvents(
  site: Site,
  resolved: ResolvedRange,
  limit = 10,
): Promise<TopEventRow[]> {
  const { rollupDates, includesToday } = splitRangeForQuery(resolved)
  const merged = new Map<string, number>()

  if (rollupDates.length > 0) {
    const rows = await db
      .select({ name: dailyEvents.name, count: sql<number>`SUM(${dailyEvents.count})` })
      .from(dailyEvents)
      .where(and(eq(dailyEvents.siteId, site.id), inArray(dailyEvents.date, rollupDates)))
      .groupBy(dailyEvents.name)
    for (const r of rows) merged.set(r.name, Number(r.count))
  }

  if (includesToday) {
    const { startSec, endSec } = todayBounds(site, resolved)
    const rows = await db
      .select({ name: events.name, count: sql<number>`COUNT(*)` })
      .from(events)
      .where(
        and(eq(events.siteId, site.id), gte(events.timestamp, startSec), lt(events.timestamp, endSec)),
      )
      .groupBy(events.name)
    for (const r of rows) merged.set(r.name, (merged.get(r.name) ?? 0) + Number(r.count))
  }

  return Array.from(merged.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
