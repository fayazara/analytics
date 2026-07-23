import { and, eq, gte, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm"
import type { Site } from "@/db/schema"
import type { ResolvedRange } from "@/lib/dates"
import { db } from "@/db"
import {
  dailyDevices,
  dailyEvents,
  dailyLocations,
  dailyOutboundLinks,
  dailyPages,
  dailySources,
  devices,
  events,
  locations,
  outboundLinks,
  pages,
  sources,
  visits,
} from "@/db/schema"
import { splitRangeForQuery, startOfDayUtcMs } from "@/lib/dates"

function todayBounds(site: Site, resolved: ResolvedRange) {
  return {
    startSec: Math.floor(startOfDayUtcMs(resolved.today, site.timezone) / 1000),
    endSec: Math.floor(Date.now() / 1000),
  }
}

export interface TopListResult<TRow> {
  rows: Array<TRow>
  total: number
}

function rankRows<TRow>(
  rows: Array<TRow>,
  value: (row: TRow) => number,
  limit: number
): TopListResult<TRow> {
  const populatedRows = rows.filter((row) => value(row) > 0)
  return {
    total: populatedRows.reduce((sum, row) => sum + value(row), 0),
    rows: populatedRows.sort((a, b) => value(b) - value(a)).slice(0, limit),
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type PageDimension = "top" | "entered" | "exited"

export interface TopPageRow {
  path: string
  count: number
}

export async function computeTopPages(
  site: Site,
  resolved: ResolvedRange,
  dimension: PageDimension = "top",
  limit = 10
): Promise<TopListResult<TopPageRow>> {
  const { rollupBounds, includesToday } = splitRangeForQuery(resolved)
  const merged = new Map<string, number>()
  const { startSec, endSec } = todayBounds(site, resolved)
  const rollupMetric =
    dimension === "entered"
      ? dailyPages.entrances
      : dimension === "exited"
        ? dailyPages.exits
        : dailyPages.pageviews

  const rollupRows = rollupBounds
    ? await db
        .select({
          path: dailyPages.path,
          count: sql<number>`SUM(${rollupMetric})`,
        })
        .from(dailyPages)
        .where(
          and(
            eq(dailyPages.siteId, site.id),
            gte(dailyPages.date, rollupBounds.from),
            lte(dailyPages.date, rollupBounds.to)
          )
        )
        .groupBy(dailyPages.path)
    : []

  for (const row of rollupRows) {
    merged.set(row.path, Number(row.count))
  }

  if (includesToday) {
    if (dimension === "top") {
      const todayRows = await db
        .select({
          path: pages.path,
          count: sql<number>`COUNT(*)`,
        })
        .from(pages)
        .where(
          and(
            eq(pages.siteId, site.id),
            gte(pages.timestamp, startSec),
            lt(pages.timestamp, endSec)
          )
        )
        .groupBy(pages.path)

      for (const row of todayRows) {
        merged.set(row.path, (merged.get(row.path) ?? 0) + Number(row.count))
      }
    } else {
      const pageColumn =
        dimension === "entered" ? visits.entryPage : visits.exitPage
      const todayRows = await db
        .select({
          path: pageColumn,
          count: sql<number>`COUNT(*)`,
        })
        .from(visits)
        .where(
          and(
            eq(visits.siteId, site.id),
            gte(visits.startedAt, startSec),
            lt(visits.startedAt, endSec),
            isNotNull(pageColumn)
          )
        )
        .groupBy(pageColumn)

      for (const row of todayRows) {
        if (!row.path) continue
        merged.set(row.path, (merged.get(row.path) ?? 0) + Number(row.count))
      }
    }
  }

  return rankRows(
    Array.from(merged, ([path, count]) => ({ path, count })),
    (row) => row.count,
    limit
  )
}

// ---------------------------------------------------------------------------
// Sources, outbound links, and UTM campaigns
// ---------------------------------------------------------------------------

export type SourceDimension = "referrer" | "links" | "utm"

export interface TopSourceRow {
  key: string
  label: string
  referrerDomain?: string
  visits: number
}

function formatUtmLabel(
  source: string,
  medium: string,
  campaign: string
): string {
  const channel = [source, medium].filter(Boolean).join(" / ")
  if (campaign && channel) return `${campaign} · ${channel}`
  return campaign || channel
}

export async function computeTopSources(
  site: Site,
  resolved: ResolvedRange,
  dimension: SourceDimension = "referrer",
  limit = 10
): Promise<TopListResult<TopSourceRow>> {
  const { rollupBounds, includesToday } = splitRangeForQuery(resolved)
  const { startSec, endSec } = todayBounds(site, resolved)
  const merged = new Map<string, TopSourceRow>()

  if (dimension === "links") {
    const [rollupRows, todayRows] = await Promise.all([
      rollupBounds
        ? db
            .select({
              url: dailyOutboundLinks.url,
              clicks: sql<number>`SUM(${dailyOutboundLinks.clicks})`,
            })
            .from(dailyOutboundLinks)
            .where(
              and(
                eq(dailyOutboundLinks.siteId, site.id),
                gte(dailyOutboundLinks.date, rollupBounds.from),
                lte(dailyOutboundLinks.date, rollupBounds.to)
              )
            )
            .groupBy(dailyOutboundLinks.url)
        : Promise.resolve([]),
      includesToday
        ? db
            .select({
              url: outboundLinks.url,
              clicks: sql<number>`COUNT(*)`,
            })
            .from(outboundLinks)
            .where(
              and(
                eq(outboundLinks.siteId, site.id),
                gte(outboundLinks.timestamp, startSec),
                lt(outboundLinks.timestamp, endSec)
              )
            )
            .groupBy(outboundLinks.url)
        : Promise.resolve([]),
    ])

    for (const row of [...rollupRows, ...todayRows]) {
      const existing = merged.get(row.url)
      merged.set(row.url, {
        key: row.url,
        label: row.url.replace(/^https?:\/\//, ""),
        referrerDomain: new URL(row.url).hostname,
        visits: (existing?.visits ?? 0) + Number(row.clicks),
      })
    }
  } else if (dimension === "utm") {
    const hasUtmRollup = or(
      ne(dailySources.utmSource, ""),
      ne(dailySources.utmMedium, ""),
      ne(dailySources.utmCampaign, "")
    )
    const hasUtmRaw = or(
      ne(sources.utmSource, ""),
      ne(sources.utmMedium, ""),
      ne(sources.utmCampaign, "")
    )
    const [rollupRows, todayRows] = await Promise.all([
      rollupBounds
        ? db
            .select({
              utmSource: dailySources.utmSource,
              utmMedium: dailySources.utmMedium,
              utmCampaign: dailySources.utmCampaign,
              visits: sql<number>`SUM(${dailySources.visits})`,
            })
            .from(dailySources)
            .where(
              and(
                eq(dailySources.siteId, site.id),
                gte(dailySources.date, rollupBounds.from),
                lte(dailySources.date, rollupBounds.to),
                hasUtmRollup
              )
            )
            .groupBy(
              dailySources.utmSource,
              dailySources.utmMedium,
              dailySources.utmCampaign
            )
        : Promise.resolve([]),
      includesToday
        ? db
            .select({
              utmSource: sources.utmSource,
              utmMedium: sources.utmMedium,
              utmCampaign: sources.utmCampaign,
              visits: sql<number>`COUNT(*)`,
            })
            .from(visits)
            .innerJoin(sources, eq(sources.id, visits.sourceId))
            .where(
              and(
                eq(visits.siteId, site.id),
                gte(visits.startedAt, startSec),
                lt(visits.startedAt, endSec),
                hasUtmRaw
              )
            )
            .groupBy(sources.utmSource, sources.utmMedium, sources.utmCampaign)
        : Promise.resolve([]),
    ])

    for (const row of [...rollupRows, ...todayRows]) {
      const source = row.utmSource ?? ""
      const medium = row.utmMedium ?? ""
      const campaign = row.utmCampaign ?? ""
      const key = `${source}\u0000${medium}\u0000${campaign}`
      const existing = merged.get(key)
      merged.set(key, {
        key,
        label: formatUtmLabel(source, medium, campaign),
        visits: (existing?.visits ?? 0) + Number(row.visits),
      })
    }
  } else {
    const [rollupRows, todayRows] = await Promise.all([
      rollupBounds
        ? db
            .select({
              referrerDomain: dailySources.referrerDomain,
              visits: sql<number>`SUM(${dailySources.visits})`,
            })
            .from(dailySources)
            .where(
              and(
                eq(dailySources.siteId, site.id),
                gte(dailySources.date, rollupBounds.from),
                lte(dailySources.date, rollupBounds.to)
              )
            )
            .groupBy(dailySources.referrerDomain)
        : Promise.resolve([]),
      includesToday
        ? db
            .select({
              referrerDomain: sources.referrerDomain,
              visits: sql<number>`COUNT(*)`,
            })
            .from(visits)
            .innerJoin(sources, eq(sources.id, visits.sourceId))
            .where(
              and(
                eq(visits.siteId, site.id),
                gte(visits.startedAt, startSec),
                lt(visits.startedAt, endSec)
              )
            )
            .groupBy(sources.referrerDomain)
        : Promise.resolve([]),
    ])

    for (const row of [...rollupRows, ...todayRows]) {
      const existing = merged.get(row.referrerDomain)
      merged.set(row.referrerDomain, {
        key: row.referrerDomain,
        label: row.referrerDomain,
        referrerDomain: row.referrerDomain,
        visits: (existing?.visits ?? 0) + Number(row.visits),
      })
    }
  }

  return rankRows(Array.from(merged.values()), (row) => row.visits, limit)
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export type DeviceDimension = "browser" | "os" | "device"

export interface TopDeviceRow {
  value: string
  visits: number
}

export async function computeTopDevices(
  site: Site,
  resolved: ResolvedRange,
  dimension: DeviceDimension = "browser",
  limit = 10
): Promise<TopListResult<TopDeviceRow>> {
  const { rollupBounds, includesToday } = splitRangeForQuery(resolved)
  const { startSec, endSec } = todayBounds(site, resolved)
  const merged = new Map<string, number>()
  const rollupColumn =
    dimension === "os"
      ? dailyDevices.os
      : dimension === "device"
        ? dailyDevices.deviceType
        : dailyDevices.browser
  const rawColumn =
    dimension === "os"
      ? devices.os
      : dimension === "device"
        ? devices.deviceType
        : devices.browser

  const [rollupRows, todayRows] = await Promise.all([
    rollupBounds
      ? db
          .select({
            value: rollupColumn,
            visits: sql<number>`SUM(${dailyDevices.visits})`,
          })
          .from(dailyDevices)
          .where(
            and(
              eq(dailyDevices.siteId, site.id),
              gte(dailyDevices.date, rollupBounds.from),
              lte(dailyDevices.date, rollupBounds.to)
            )
          )
          .groupBy(rollupColumn)
      : Promise.resolve([]),
    includesToday
      ? db
          .select({
            value: rawColumn,
            visits: sql<number>`COUNT(*)`,
          })
          .from(visits)
          .innerJoin(devices, eq(devices.id, visits.deviceId))
          .where(
            and(
              eq(visits.siteId, site.id),
              gte(visits.startedAt, startSec),
              lt(visits.startedAt, endSec)
            )
          )
          .groupBy(rawColumn)
      : Promise.resolve([]),
  ])

  for (const row of [...rollupRows, ...todayRows]) {
    if (!row.value) continue
    merged.set(row.value, (merged.get(row.value) ?? 0) + Number(row.visits))
  }

  return rankRows(
    Array.from(merged, ([value, rowVisits]) => ({
      value,
      visits: rowVisits,
    })),
    (row) => row.visits,
    limit
  )
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export type LocationDimension = "country" | "region" | "city"

export interface TopLocationRow {
  country: string
  region: string
  city: string
  visits: number
}

export async function computeTopLocations(
  site: Site,
  resolved: ResolvedRange,
  dimension: LocationDimension = "country",
  limit = 10
): Promise<TopListResult<TopLocationRow>> {
  const { rollupBounds, includesToday } = splitRangeForQuery(resolved)
  const { startSec, endSec } = todayBounds(site, resolved)
  const merged = new Map<string, TopLocationRow>()
  const rollupRegion =
    dimension === "country" ? sql<string>`''` : dailyLocations.region
  const rollupCity =
    dimension === "city" ? dailyLocations.city : sql<string>`''`
  const rawRegion = dimension === "country" ? sql<string>`''` : locations.region
  const rawCity = dimension === "city" ? locations.city : sql<string>`''`

  const rollupRows = rollupBounds
    ? await db
        .select({
          country: dailyLocations.country,
          region: rollupRegion,
          city: rollupCity,
          visits: sql<number>`SUM(${dailyLocations.visits})`,
        })
        .from(dailyLocations)
        .where(
          and(
            eq(dailyLocations.siteId, site.id),
            gte(dailyLocations.date, rollupBounds.from),
            lte(dailyLocations.date, rollupBounds.to),
            dimension === "region" ? ne(dailyLocations.region, "") : undefined,
            dimension === "city" ? ne(dailyLocations.city, "") : undefined
          )
        )
        .groupBy(dailyLocations.country, rollupRegion, rollupCity)
    : []

  const todayRows = includesToday
    ? await db
        .select({
          country: locations.country,
          region: rawRegion,
          city: rawCity,
          visits: sql<number>`COUNT(*)`,
        })
        .from(visits)
        .innerJoin(locations, eq(locations.id, visits.locationId))
        .where(
          and(
            eq(visits.siteId, site.id),
            gte(visits.startedAt, startSec),
            lt(visits.startedAt, endSec),
            dimension === "region" ? ne(locations.region, "") : undefined,
            dimension === "city" ? ne(locations.city, "") : undefined
          )
        )
        .groupBy(locations.country, rawRegion, rawCity)
    : []

  for (const row of [...rollupRows, ...todayRows]) {
    const region = dimension === "country" ? "" : (row.region ?? "")
    const city = dimension === "city" ? (row.city ?? "") : ""
    const key = `${row.country}\u0000${region}\u0000${city}`
    const existing = merged.get(key)
    merged.set(key, {
      country: row.country,
      region,
      city,
      visits: (existing?.visits ?? 0) + Number(row.visits),
    })
  }

  return rankRows(Array.from(merged.values()), (row) => row.visits, limit)
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
  limit = 10
): Promise<Array<TopEventRow>> {
  const { rollupBounds, includesToday } = splitRangeForQuery(resolved)
  const merged = new Map<string, number>()
  const { startSec, endSec } = todayBounds(site, resolved)

  const [rollupRows, todayRows] = await Promise.all([
    rollupBounds
      ? db
          .select({
            name: dailyEvents.name,
            count: sql<number>`SUM(${dailyEvents.count})`,
          })
          .from(dailyEvents)
          .where(
            and(
              eq(dailyEvents.siteId, site.id),
              gte(dailyEvents.date, rollupBounds.from),
              lte(dailyEvents.date, rollupBounds.to)
            )
          )
          .groupBy(dailyEvents.name)
      : Promise.resolve([]),
    includesToday
      ? db
          .select({ name: events.name, count: sql<number>`COUNT(*)` })
          .from(events)
          .where(
            and(
              eq(events.siteId, site.id),
              gte(events.timestamp, startSec),
              lt(events.timestamp, endSec)
            )
          )
          .groupBy(events.name)
      : Promise.resolve([]),
  ])

  for (const row of rollupRows) merged.set(row.name, Number(row.count))
  for (const row of todayRows) {
    merged.set(row.name, (merged.get(row.name) ?? 0) + Number(row.count))
  }

  return Array.from(merged.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
