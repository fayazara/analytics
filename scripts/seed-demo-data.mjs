#!/usr/bin/env node
/**
 * Seeds realistic demo data for local development.
 *
 * Writes rollup rows (`daily_*`) for the past N days directly — that's
 * all the dashboard reads for any range except "today" (see §8 of the
 * spec) — plus a smaller batch of *raw* rows for "today" so the raw-table
 * code path has something to show too.
 *
 * Usage:
 *   node scripts/seed-demo-data.mjs <site-id> [days]
 *
 * Then apply the generated SQL with:
 *   npx wrangler d1 execute DB --local --file=./seed-output.sql
 *
 * (This script only *generates* the SQL file — it doesn't touch D1
 * itself, so it has no dependency on wrangler/miniflare internals.)
 */
import { randomBytes, randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"

const siteId = process.argv[2]
const days = Number(process.argv[3] ?? 90)

if (!siteId) {
  console.error("Usage: node scripts/seed-demo-data.mjs <site-id> [days]")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Weighted real-world dictionaries
// ---------------------------------------------------------------------------

const REFERRERS = [
  {
    referrerDomain: "(direct)",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 30,
  },
  {
    referrerDomain: "google.com",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 26,
  },
  {
    referrerDomain: "github.com",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 9,
  },
  {
    referrerDomain: "news.ycombinator.com",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 7,
  },
  {
    referrerDomain: "t.co",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 5,
  },
  {
    referrerDomain: "reddit.com",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 5,
  },
  {
    referrerDomain: "producthunt.com",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 4,
  },
  {
    referrerDomain: "linkedin.com",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 3,
  },
  {
    referrerDomain: "bing.com",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 3,
  },
  {
    referrerDomain: "dev.to",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 3,
  },
  {
    referrerDomain: "facebook.com",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    weight: 2,
  },
  {
    referrerDomain: "(direct)",
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "weekly-digest",
    weight: 4,
  },
  {
    referrerDomain: "twitter.com",
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "launch",
    weight: 3,
  },
  {
    referrerDomain: "linkedin.com",
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-update",
    weight: 3,
  },
  {
    referrerDomain: "google.com",
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "summer-launch",
    weight: 2,
  },
  {
    referrerDomain: "producthunt.com",
    utmSource: "product-hunt",
    utmMedium: "referral",
    utmCampaign: "launch-day",
    weight: 2,
  },
]

const DEVICES = [
  { browser: "Chrome", os: "Windows", deviceType: "desktop", weight: 30 },
  { browser: "Chrome", os: "macOS", deviceType: "desktop", weight: 18 },
  { browser: "Safari", os: "macOS", deviceType: "desktop", weight: 12 },
  { browser: "Safari", os: "iOS", deviceType: "mobile", weight: 14 },
  { browser: "Chrome", os: "Android", deviceType: "mobile", weight: 10 },
  { browser: "Firefox", os: "Windows", deviceType: "desktop", weight: 6 },
  { browser: "Edge", os: "Windows", deviceType: "desktop", weight: 5 },
  { browser: "Safari", os: "iOS", deviceType: "tablet", weight: 3 },
  {
    browser: "Samsung Internet",
    os: "Android",
    deviceType: "mobile",
    weight: 2,
  },
]

const LOCATIONS = [
  { country: "US", region: "CA", city: "San Francisco", weight: 14 },
  { country: "US", region: "NY", city: "New York", weight: 12 },
  { country: "US", region: "TX", city: "Austin", weight: 8 },
  { country: "US", region: "WA", city: "Seattle", weight: 6 },
  { country: "GB", region: "", city: "London", weight: 10 },
  { country: "IN", region: "KA", city: "Bangalore", weight: 9 },
  { country: "IN", region: "MH", city: "Mumbai", weight: 5 },
  { country: "DE", region: "BE", city: "Berlin", weight: 7 },
  { country: "CA", region: "ON", city: "Toronto", weight: 6 },
  { country: "AU", region: "NSW", city: "Sydney", weight: 5 },
  { country: "NL", region: "", city: "Amsterdam", weight: 4 },
  { country: "FR", region: "", city: "Paris", weight: 4 },
  { country: "JP", region: "", city: "Tokyo", weight: 4 },
  { country: "BR", region: "SP", city: "Sao Paulo", weight: 4 },
  { country: "SG", region: "", city: "Singapore", weight: 3 },
]

const PAGES = [
  { path: "/", title: "SuperSaaS – Ship your SaaS faster", weight: 35 },
  { path: "/pricing", title: "Pricing – SuperSaaS", weight: 15 },
  { path: "/docs", title: "Docs – SuperSaaS", weight: 12 },
  {
    path: "/docs/getting-started",
    title: "Getting Started – SuperSaaS",
    weight: 10,
  },
  { path: "/blog", title: "Blog – SuperSaaS", weight: 8 },
  {
    path: "/blog/how-we-built-supersaas",
    title: "How we built SuperSaaS",
    weight: 6,
  },
  { path: "/changelog", title: "Changelog – SuperSaaS", weight: 5 },
  { path: "/about", title: "About – SuperSaaS", weight: 5 },
  { path: "/contact", title: "Contact – SuperSaaS", weight: 4 },
]

const EVENT_RULES = [
  { name: "signup", pages: ["/pricing", "/"], chance: 0.06 },
  { name: "pricing_click", pages: ["/"], chance: 0.08 },
  {
    name: "docs_search",
    pages: ["/docs", "/docs/getting-started"],
    chance: 0.12,
  },
  { name: "newsletter_subscribe", pages: ["/blog", "/"], chance: 0.04 },
  { name: "cta_click", pages: ["/", "/pricing"], chance: 0.1 },
]

const OUTBOUND_LINKS = [
  { url: "https://github.com/supersaas", weight: 35 },
  { url: "https://docs.cloudflare.com/workers", weight: 22 },
  { url: "https://discord.com/invite/supersaas", weight: 18 },
  { url: "https://x.com/supersaas", weight: 15 },
  { url: "https://status.supersaas.example", weight: 10 },
]

const PAGE_COUNT_WEIGHTS = [1, 1, 1, 2, 2, 3, 4, 5]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function weightedPick(items) {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = Math.random() * total
  for (const item of items) {
    if (r < item.weight) return item
    r -= item.weight
  }
  return items[items.length - 1]
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function newVisitorId() {
  return randomBytes(16).toString("hex")
}

function esc(value) {
  if (value === null || value === undefined) return "NULL"
  return `'${String(value).replace(/'/g, "''")}'`
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10)
}

const sourceKeySeen = new Set()
const deviceKeySeen = new Set()
const locationKeySeen = new Set()
const lookupInserts = []

function ensureSourceLookup(ref) {
  const key = `${ref.referrerDomain}\u0000${ref.utmSource}\u0000${ref.utmMedium}\u0000${ref.utmCampaign}`
  if (!sourceKeySeen.has(key)) {
    sourceKeySeen.add(key)
    lookupInserts.push(
      `INSERT OR IGNORE INTO sources (site_id, referrer_domain, utm_source, utm_medium, utm_campaign) VALUES (${esc(siteId)}, ${esc(ref.referrerDomain)}, ${esc(ref.utmSource)}, ${esc(ref.utmMedium)}, ${esc(ref.utmCampaign)});`
    )
  }
}

function ensureDeviceLookup(dev) {
  const key = `${dev.browser}\u0000${dev.os}\u0000${dev.deviceType}`
  if (!deviceKeySeen.has(key)) {
    deviceKeySeen.add(key)
    lookupInserts.push(
      `INSERT OR IGNORE INTO devices (browser, os, device_type) VALUES (${esc(dev.browser)}, ${esc(dev.os)}, ${esc(dev.deviceType)});`
    )
  }
}

function ensureLocationLookup(loc) {
  const key = `${loc.country}\u0000${loc.region}\u0000${loc.city}`
  if (!locationKeySeen.has(key)) {
    locationKeySeen.add(key)
    lookupInserts.push(
      `INSERT OR IGNORE INTO locations (country, region, city) VALUES (${esc(loc.country)}, ${esc(loc.region)}, ${esc(loc.city)});`
    )
  }
}

function sourceIdSubquery(ref) {
  return `(SELECT id FROM sources WHERE site_id = ${esc(siteId)} AND referrer_domain = ${esc(ref.referrerDomain)} AND utm_source = ${esc(ref.utmSource)} AND utm_medium = ${esc(ref.utmMedium)} AND utm_campaign = ${esc(ref.utmCampaign)})`
}
function deviceIdSubquery(dev) {
  return `(SELECT id FROM devices WHERE browser = ${esc(dev.browser)} AND os = ${esc(dev.os)} AND device_type = ${esc(dev.deviceType)})`
}
function locationIdSubquery(loc) {
  return `(SELECT id FROM locations WHERE country = ${esc(loc.country)} AND region = ${esc(loc.region)} AND city = ${esc(loc.city)})`
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const statements = []

const allVisitorIds = []
const visitorFirstSeen = new Map()
const visitorLastSeen = new Map()

function pickVisitorId() {
  if (allVisitorIds.length > 0 && Math.random() < 0.32) {
    return pick(allVisitorIds)
  }
  const id = newVisitorId()
  allVisitorIds.push(id)
  return id
}

function markVisitorSeen(id, sec) {
  if (!visitorFirstSeen.has(id) || sec < visitorFirstSeen.get(id))
    visitorFirstSeen.set(id, sec)
  if (!visitorLastSeen.has(id) || sec > visitorLastSeen.get(id))
    visitorLastSeen.set(id, sec)
}

const now = new Date()
const todayStr = fmtDate(now)

// --- Historical days: rollups only (§8 — dashboard never scans raw for
// historical ranges, so raw rows for old days would just be dead weight).
for (let offset = days; offset >= 1; offset--) {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - offset)
  const dateStr = fmtDate(date)
  const dow = date.getUTCDay()
  const weekdayMultiplier = dow === 0 || dow === 6 ? 0.6 : 1.0
  const growth = 1 - (offset / days) * 0.55 // ramps up towards "today"
  const jitter = 0.7 + Math.random() * 0.6
  const visitCount = Math.max(
    3,
    Math.round(40 * growth * weekdayMultiplier * jitter)
  )

  let pageviews = 0
  let bounces = 0
  let durationSum = 0
  const visitorSet = new Set()
  const pageStats = new Map() // path -> { views, visitors: Set, entrances, exits }
  const sourceStats = new Map() // key -> { ref, visits }
  const deviceStats = new Map() // key -> { dev, visits }
  const locationStats = new Map() // key -> { loc, visits }
  const outboundLinkStats = new Map() // URL -> clicks
  const eventStats = new Map() // name -> count

  for (let i = 0; i < visitCount; i++) {
    const visitorId = pickVisitorId()
    visitorSet.add(visitorId)

    const device = weightedPick(DEVICES)
    const location = weightedPick(LOCATIONS)
    const referrer = weightedPick(REFERRERS)

    const pageCount = pick(PAGE_COUNT_WEIGHTS)
    const isBounce = pageCount === 1
    const duration = isBounce ? randInt(4, 45) : randInt(20, 180) * pageCount
    durationSum += duration
    pageviews += pageCount
    if (isBounce) bounces++

    const visitedPaths = []
    visitedPaths.push(weightedPick(PAGES))
    for (let p = 1; p < pageCount; p++) visitedPaths.push(weightedPick(PAGES))

    for (const pg of visitedPaths) {
      const stat = pageStats.get(pg.path) ?? {
        views: 0,
        visitors: new Set(),
        entrances: 0,
        exits: 0,
      }
      stat.views++
      stat.visitors.add(visitorId)
      pageStats.set(pg.path, stat)

      for (const rule of EVENT_RULES) {
        if (rule.pages.includes(pg.path) && Math.random() < rule.chance) {
          eventStats.set(rule.name, (eventStats.get(rule.name) ?? 0) + 1)
        }
      }
    }

    pageStats.get(visitedPaths[0].path).entrances++
    pageStats.get(visitedPaths[visitedPaths.length - 1].path).exits++

    if (Math.random() < 0.18) {
      const link = weightedPick(OUTBOUND_LINKS)
      outboundLinkStats.set(
        link.url,
        (outboundLinkStats.get(link.url) ?? 0) + 1
      )
    }

    const sKey = `${referrer.referrerDomain}\u0000${referrer.utmSource}\u0000${referrer.utmMedium}\u0000${referrer.utmCampaign}`
    const sStat = sourceStats.get(sKey) ?? { referrer, visits: 0 }
    sStat.visits++
    sourceStats.set(sKey, sStat)

    const dKey = `${device.deviceType}\u0000${device.browser}\u0000${device.os}`
    const dStat = deviceStats.get(dKey) ?? { device, visits: 0 }
    dStat.visits++
    deviceStats.set(dKey, dStat)

    const lKey = `${location.country}\u0000${location.region}\u0000${location.city}`
    const lStat = locationStats.get(lKey) ?? { location, visits: 0 }
    lStat.visits++
    locationStats.set(lKey, lStat)
  }

  const bounceRate = visitCount > 0 ? bounces / visitCount : 0
  const avgDuration = visitCount > 0 ? durationSum / visitCount : 0

  statements.push(
    `INSERT INTO daily_summary (site_id, date, visitors, visits, pageviews, bounce_rate, avg_duration_seconds) VALUES (${esc(siteId)}, ${esc(dateStr)}, ${visitorSet.size}, ${visitCount}, ${pageviews}, ${bounceRate.toFixed(4)}, ${avgDuration.toFixed(2)}) ON CONFLICT (site_id, date) DO UPDATE SET visitors=excluded.visitors, visits=excluded.visits, pageviews=excluded.pageviews, bounce_rate=excluded.bounce_rate, avg_duration_seconds=excluded.avg_duration_seconds;`
  )

  for (const [path, stat] of pageStats) {
    statements.push(
      `INSERT INTO daily_pages (site_id, date, path, pageviews, visitors, entrances, exits) VALUES (${esc(siteId)}, ${esc(dateStr)}, ${esc(path)}, ${stat.views}, ${stat.visitors.size}, ${stat.entrances}, ${stat.exits}) ON CONFLICT (site_id, date, path) DO UPDATE SET pageviews=excluded.pageviews, visitors=excluded.visitors, entrances=excluded.entrances, exits=excluded.exits;`
    )
  }
  for (const { referrer, visits } of sourceStats.values()) {
    statements.push(
      `INSERT INTO daily_sources (site_id, date, referrer_domain, utm_source, utm_medium, utm_campaign, visits) VALUES (${esc(siteId)}, ${esc(dateStr)}, ${esc(referrer.referrerDomain)}, ${esc(referrer.utmSource)}, ${esc(referrer.utmMedium)}, ${esc(referrer.utmCampaign)}, ${visits}) ON CONFLICT (site_id, date, referrer_domain, utm_source, utm_medium, utm_campaign) DO UPDATE SET visits=excluded.visits;`
    )
  }
  for (const { device, visits } of deviceStats.values()) {
    statements.push(
      `INSERT INTO daily_devices (site_id, date, device_type, browser, os, visits) VALUES (${esc(siteId)}, ${esc(dateStr)}, ${esc(device.deviceType)}, ${esc(device.browser)}, ${esc(device.os)}, ${visits}) ON CONFLICT (site_id, date, device_type, browser, os) DO UPDATE SET visits=excluded.visits;`
    )
  }
  for (const { location, visits } of locationStats.values()) {
    statements.push(
      `INSERT INTO daily_locations (site_id, date, country, region, city, visits) VALUES (${esc(siteId)}, ${esc(dateStr)}, ${esc(location.country)}, ${esc(location.region)}, ${esc(location.city)}, ${visits}) ON CONFLICT (site_id, date, country, region, city) DO UPDATE SET visits=excluded.visits;`
    )
  }
  for (const [url, clicks] of outboundLinkStats) {
    statements.push(
      `INSERT INTO daily_outbound_links (site_id, date, url, clicks) VALUES (${esc(siteId)}, ${esc(dateStr)}, ${esc(url)}, ${clicks}) ON CONFLICT (site_id, date, url) DO UPDATE SET clicks=excluded.clicks;`
    )
  }
  for (const [name, count] of eventStats) {
    statements.push(
      `INSERT INTO daily_events (site_id, date, name, count) VALUES (${esc(siteId)}, ${esc(dateStr)}, ${esc(name)}, ${count}) ON CONFLICT (site_id, date, name) DO UPDATE SET count=excluded.count;`
    )
  }
}

// --- Today: raw rows only (§8 — "today" is the one slice the dashboard
// reads live from the raw tables).
const elapsedFraction = Math.min(
  1,
  (now.getUTCHours() * 60 + now.getUTCMinutes()) / (24 * 60)
)
const todayVisitCount = Math.max(
  2,
  Math.round(45 * elapsedFraction * (0.7 + Math.random() * 0.6))
)
const todayStartSec = Math.floor(
  new Date(`${todayStr}T00:00:00Z`).getTime() / 1000
)
const nowSec = Math.floor(now.getTime() / 1000)

for (let i = 0; i < todayVisitCount; i++) {
  const visitorId = pickVisitorId()
  const device = weightedPick(DEVICES)
  const location = weightedPick(LOCATIONS)
  const referrer = weightedPick(REFERRERS)
  ensureDeviceLookup(device)
  ensureLocationLookup(location)
  ensureSourceLookup(referrer)

  const pageCount = pick(PAGE_COUNT_WEIGHTS)
  const isBounce = pageCount === 1
  const startedAt = randInt(todayStartSec, nowSec)
  const perPageGap = randInt(15, 90)
  const endedAt = isBounce
    ? startedAt + randInt(4, 45)
    : startedAt + perPageGap * (pageCount - 1)

  markVisitorSeen(visitorId, startedAt)
  markVisitorSeen(visitorId, endedAt)

  const visitId = randomUUID()
  const visitedPaths = [weightedPick(PAGES)]
  for (let p = 1; p < pageCount; p++) visitedPaths.push(weightedPick(PAGES))
  const entryPage = visitedPaths[0].path
  const exitPage = visitedPaths[visitedPaths.length - 1].path

  statements.push(
    `INSERT INTO visits (id, site_id, visitor_id, started_at, ended_at, entry_page, exit_page, page_count, is_bounce, source_id, device_id, location_id) VALUES (${esc(visitId)}, ${esc(siteId)}, ${esc(visitorId)}, ${startedAt}, ${endedAt}, ${esc(entryPage)}, ${esc(exitPage)}, ${pageCount}, ${isBounce ? 1 : 0}, ${sourceIdSubquery(referrer)}, ${deviceIdSubquery(device)}, ${locationIdSubquery(location)});`
  )

  visitedPaths.forEach((pg, idx) => {
    const ts = pageCount === 1 ? startedAt : startedAt + idx * perPageGap
    statements.push(
      `INSERT INTO pages (site_id, visit_id, path, title, timestamp) VALUES (${esc(siteId)}, ${esc(visitId)}, ${esc(pg.path)}, ${esc(pg.title)}, ${ts});`
    )
    for (const rule of EVENT_RULES) {
      if (rule.pages.includes(pg.path) && Math.random() < rule.chance) {
        statements.push(
          `INSERT INTO events (site_id, visit_id, name, props, timestamp) VALUES (${esc(siteId)}, ${esc(visitId)}, ${esc(rule.name)}, NULL, ${ts});`
        )
      }
    }
  })

  if (Math.random() < 0.18) {
    const link = weightedPick(OUTBOUND_LINKS)
    statements.push(
      `INSERT INTO outbound_links (site_id, visitor_id, url, timestamp) VALUES (${esc(siteId)}, ${esc(visitorId)}, ${esc(link.url)}, ${endedAt});`
    )
  }
}

const visitorRows = []
for (const [id, first] of visitorFirstSeen) {
  const last = visitorLastSeen.get(id)
  visitorRows.push(
    `INSERT INTO visitors (id, site_id, first_seen, last_seen) VALUES (${esc(id)}, ${esc(siteId)}, ${first}, ${last}) ON CONFLICT (id) DO UPDATE SET last_seen=excluded.last_seen;`
  )
}

// ---------------------------------------------------------------------------
// Assemble output — lookups first (FK targets), then visitors, then the
// historical rollups + today's raw rows.
// ---------------------------------------------------------------------------

const output = [...lookupInserts, ...visitorRows, ...statements].join("\n")
writeFileSync("seed-output.sql", output)

console.log(
  `Generated ${statements.length + lookupInserts.length + visitorRows.length} statements`
)
console.log(`  - ${days} days of daily_* rollups`)
console.log(`  - ${todayVisitCount} raw visits for today (${todayStr})`)
console.log(`  - ${visitorRows.length} distinct visitors`)
console.log(`Wrote seed-output.sql`)
