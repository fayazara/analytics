import {
  index,
  int,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import type { z } from "zod"

/**
 * Personal Web Analytics — data model.
 *
 * See web-analytics-spec.md §5 for the full rationale. Two families of
 * tables:
 *
 *  - Raw tables (sites, visitors, visits, pages, outbound links, sources,
 *    devices, locations, events) — written by `/collect`.
 *  - Rollup tables (daily_*) — written once a day by the cron trigger
 *    (see src/lib/aggregate.ts). The dashboard reads exclusively from
 *    these for any range that doesn't include "today".
 */

// ---------------------------------------------------------------------------
// Raw tables
// ---------------------------------------------------------------------------

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(), // uuid
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: int("created_at").notNull(),
})

export const visitors = sqliteTable(
  "visitors",
  {
    id: text("id").primaryKey(), // sha256(site_id + IP + UA), see §4
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    firstSeen: int("first_seen").notNull(),
    lastSeen: int("last_seen").notNull(),
  },
  (t) => [index("idx_visitors_site_seen").on(t.siteId, t.lastSeen)]
)

export const sources = sqliteTable(
  "sources",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    referrerDomain: text("referrer_domain").notNull().default("(direct)"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
  },
  (t) => [
    uniqueIndex("idx_sources_unique").on(
      t.siteId,
      t.referrerDomain,
      t.utmSource,
      t.utmMedium,
      t.utmCampaign
    ),
  ]
)

export const devices = sqliteTable(
  "devices",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    browser: text("browser").notNull(),
    os: text("os").notNull(),
    deviceType: text("device_type").notNull(), // desktop | mobile | tablet
  },
  (t) => [uniqueIndex("idx_devices_unique").on(t.browser, t.os, t.deviceType)]
)

export const locations = sqliteTable(
  "locations",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    country: text("country").notNull(), // ISO-2 country code
    region: text("region"),
    city: text("city"),
  },
  (t) => [uniqueIndex("idx_locations_unique").on(t.country, t.region, t.city)]
)

export const visits = sqliteTable(
  "visits",
  {
    id: text("id").primaryKey(), // uuid
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    visitorId: text("visitor_id")
      .notNull()
      .references(() => visitors.id),
    startedAt: int("started_at").notNull(),
    endedAt: int("ended_at").notNull(),
    entryPage: text("entry_page"),
    exitPage: text("exit_page"),
    pageCount: int("page_count").notNull().default(1),
    isBounce: int("is_bounce", { mode: "boolean" }).notNull().default(true),
    sourceId: int("source_id").references(() => sources.id),
    deviceId: int("device_id").references(() => devices.id),
    locationId: int("location_id").references(() => locations.id),
  },
  (t) => [
    index("idx_visits_site_started").on(t.siteId, t.startedAt),
    index("idx_visits_visitor").on(t.visitorId, t.startedAt),
  ]
)

export const pages = sqliteTable(
  "pages",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    path: text("path").notNull(),
    title: text("title"),
    timestamp: int("timestamp").notNull(),
  },
  (t) => [
    index("idx_pages_site_ts").on(t.siteId, t.timestamp),
    index("idx_pages_visit").on(t.visitId),
  ]
)

export const outboundLinks = sqliteTable(
  "outbound_links",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    visitorId: text("visitor_id")
      .notNull()
      .references(() => visitors.id),
    url: text("url").notNull(),
    timestamp: int("timestamp").notNull(),
  },
  (t) => [index("idx_outbound_links_site_ts").on(t.siteId, t.timestamp)]
)

export const events = sqliteTable(
  "events",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    name: text("name").notNull(),
    props: text("props"), // JSON blob, small (<2KB)
    timestamp: int("timestamp").notNull(),
  },
  (t) => [index("idx_events_site_name_ts").on(t.siteId, t.name, t.timestamp)]
)

// ---------------------------------------------------------------------------
// Rollup tables — written by cron, read by the dashboard (§7, §8)
// ---------------------------------------------------------------------------

export const dailySummary = sqliteTable(
  "daily_summary",
  {
    siteId: text("site_id").notNull(),
    date: text("date").notNull(), // 'YYYY-MM-DD'
    visitors: int("visitors").notNull(),
    visits: int("visits").notNull(),
    pageviews: int("pageviews").notNull(),
    bounceRate: real("bounce_rate").notNull(),
    avgDurationSeconds: real("avg_duration_seconds").notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.date] })]
)

export const dailyPages = sqliteTable(
  "daily_pages",
  {
    siteId: text("site_id").notNull(),
    date: text("date").notNull(),
    path: text("path").notNull(),
    pageviews: int("pageviews").notNull(),
    visitors: int("visitors").notNull(),
    entrances: int("entrances").notNull().default(0),
    exits: int("exits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.date, t.path] })]
)

export const dailySources = sqliteTable(
  "daily_sources",
  {
    siteId: text("site_id").notNull(),
    date: text("date").notNull(),
    referrerDomain: text("referrer_domain").notNull(),
    utmSource: text("utm_source").notNull().default(""),
    utmMedium: text("utm_medium").notNull().default(""),
    utmCampaign: text("utm_campaign").notNull().default(""),
    visits: int("visits").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.siteId,
        t.date,
        t.referrerDomain,
        t.utmSource,
        t.utmMedium,
        t.utmCampaign,
      ],
    }),
  ]
)

export const dailyDevices = sqliteTable(
  "daily_devices",
  {
    siteId: text("site_id").notNull(),
    date: text("date").notNull(),
    deviceType: text("device_type").notNull(),
    browser: text("browser").notNull(),
    os: text("os").notNull().default(""),
    visits: int("visits").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.siteId, t.date, t.deviceType, t.browser, t.os],
    }),
  ]
)

export const dailyLocations = sqliteTable(
  "daily_locations",
  {
    siteId: text("site_id").notNull(),
    date: text("date").notNull(),
    country: text("country").notNull(),
    region: text("region").notNull().default(""),
    city: text("city").notNull().default(""),
    visits: int("visits").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.siteId, t.date, t.country, t.region, t.city],
    }),
  ]
)

export const dailyOutboundLinks = sqliteTable(
  "daily_outbound_links",
  {
    siteId: text("site_id").notNull(),
    date: text("date").notNull(),
    url: text("url").notNull(),
    clicks: int("clicks").notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.date, t.url] })]
)

export const dailyEvents = sqliteTable(
  "daily_events",
  {
    siteId: text("site_id").notNull(),
    date: text("date").notNull(),
    name: text("name").notNull(),
    count: int("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.date, t.name] })]
)

// ---------------------------------------------------------------------------
// Types + Zod schemas
// ---------------------------------------------------------------------------

export type Site = typeof sites.$inferSelect
export type NewSite = typeof sites.$inferInsert

export const selectSiteSchema = createSelectSchema(sites)
export const insertSiteSchema = createInsertSchema(sites, {
  name: (schema) => schema.min(1).max(100),
  domain: (schema) => schema.min(1).max(253),
  timezone: (schema) => schema.min(1).max(64),
})
  .pick({ name: true, domain: true, timezone: true })
  .partial({ timezone: true })

export type InsertSiteInput = z.infer<typeof insertSiteSchema>

export type Visitor = typeof visitors.$inferSelect
export type Visit = typeof visits.$inferSelect
export type Page = typeof pages.$inferSelect
export type OutboundLink = typeof outboundLinks.$inferSelect
export type NewOutboundLink = typeof outboundLinks.$inferInsert
export type EventRow = typeof events.$inferSelect

export const selectOutboundLinkSchema = createSelectSchema(outboundLinks)
export const insertOutboundLinkSchema = createInsertSchema(outboundLinks, {
  url: (schema) => schema.url().max(2048),
}).pick({
  siteId: true,
  visitorId: true,
  url: true,
  timestamp: true,
})

export type InsertOutboundLinkInput = z.infer<typeof insertOutboundLinkSchema>
