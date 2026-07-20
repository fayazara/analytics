# Personal Web Analytics — Technical Spec

**Status:** Draft
**Owner:** Fayaz
**Stack:** Cloudflare Workers + D1 + Cron Triggers + Durable Objects, single-user, no auth complexity beyond one owner

---

## 1. Overview

A self-hosted, privacy-friendly web analytics tool for personal projects. Single owner, unlimited sites, no teams/orgs/multi-tenant concerns. Cookieless tracking, using Cloudflare's edge (`request.cf`) for geo data instead of a third-party GeoIP lookup.

Runs entirely on the Workers Paid ($5/mo) plan: Worker (ingestion + API + dashboard), D1 (storage), Cron Triggers (aggregation), Durable Objects (live visitor count, §11).

## 2. Goals / Non-Goals

**Goals**

- Track pageviews, sessions (visits), sources/referrers, device, location, and custom events — per site.
- One dashboard page per site: summary stats, time-series chart, top pages/sources/devices/locations, custom events.
- Cheap to run indefinitely at ~100k visits/month across all sites combined.
- Cookieless — no consent banner needed.
- Dashboard stays fast even with years of history, by never scanning raw events for historical ranges.

**Non-Goals**

- No teams, no per-user permissions, no public dashboards, no A/B testing, no session replay.
- No cookies, no client-side storage. Visitor identity is a stable server-side hash of IP + User-Agent (§4) — accurate multi-day uniques, at the normal limits of IP+UA fingerprinting (changes when IP or browser version changes).

## 3. Architecture

```
Browser (site being tracked)
   │  tiny JS snippet → POST /collect
   ▼
Cloudflare Worker (ingestion)
   │  reads request.cf.{country,city,region}, CF-Connecting-IP, User-Agent, Referer
   │  writes raw rows to D1 (via ctx.waitUntil — non-blocking)
   │  also pings the site's LiveVisitors Durable Object (fire-and-forget)
   ▼
D1 (raw tables: visitors, visits, pages, events, + lookup tables)     LiveVisitors DO (one per site)
                                                                          │  in-memory Map<visitor_id, lastSeen>
                                                                          │  60s alarm sweeps + rebroadcasts count
                                                                          ▼
                                                                       WebSocket → dashboard (live count, no polling)

Cron Trigger (daily, e.g. 00:10 UTC)
   │  reads previous day's raw rows per site
   │  writes/replaces rollup rows
   ▼
D1 (daily_* rollup tables)

Dashboard (single Vue/Nuxt page, static, calls Worker API)
   │  "today" → raw tables
   │  anything older → rollup tables only, never raw
   ▼
Worker API (/api/sites/:id/...)
```

One D1 database total is fine at this scale (see §9 — sizing). No sharding, no Analytics Engine, no Queues needed.

## 4. Visitor & Session Identification (cookieless)

- `visitor_id = sha256(site_id + CF-Connecting-IP + User-Agent)`, truncated to 16 bytes. **No date component** — the same person gets the same ID across days, so multi-day/weekly/monthly unique-visitor counts are accurate, not a sum of daily approximations.
- Still no cookie, no client-side storage, no fingerprint sent from the browser — everything needed to compute the hash is already in the request (IP + UA), same as before. The trade-off: this is a persistent (not daily-rotating) server-side identifier, so it's a stronger form of tracking than the daily-rotating version, even though nothing is stored in the browser. It naturally breaks/re-identifies as "new" when a visitor's IP changes (mobile networks, VPNs) or User-Agent changes (browser update) — that's a limitation of IP+UA fingerprinting in general, not something worth engineering around for a personal-project scale tool.
- **Session (visit):** on each pageview, look up the visitor's most recent visit. If it started less than 30 minutes ago, append to it (increment `page_count`, update `ended_at`, `exit_page`). Otherwise start a new visit row. This is 1 SELECT + 1 UPDATE/INSERT per pageview — trivial at this volume (see §9).

## 5. Data Model (D1 / SQLite)

### Raw tables

```sql
CREATE TABLE sites (
  id TEXT PRIMARY KEY,           -- uuid
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL
);

CREATE TABLE visitors (
  id TEXT PRIMARY KEY,           -- stable sha256(site_id + IP + UA) hash, see §4
  site_id TEXT NOT NULL REFERENCES sites(id),
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX idx_visitors_site_seen ON visitors(site_id, last_seen);

CREATE TABLE visits (
  id TEXT PRIMARY KEY,           -- uuid
  site_id TEXT NOT NULL REFERENCES sites(id),
  visitor_id TEXT NOT NULL REFERENCES visitors(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  entry_page TEXT,
  exit_page TEXT,
  page_count INTEGER NOT NULL DEFAULT 1,
  is_bounce INTEGER NOT NULL DEFAULT 1,   -- 1 until 2nd pageview
  source_id INTEGER REFERENCES sources(id),
  device_id INTEGER REFERENCES devices(id),
  location_id INTEGER REFERENCES locations(id)
);
CREATE INDEX idx_visits_site_started ON visits(site_id, started_at);
CREATE INDEX idx_visits_visitor ON visits(visitor_id, started_at);

CREATE TABLE pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id),
  visit_id TEXT NOT NULL REFERENCES visits(id),
  path TEXT NOT NULL,
  title TEXT,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_pages_site_ts ON pages(site_id, timestamp);
CREATE INDEX idx_pages_visit ON pages(visit_id);

CREATE TABLE sources (               -- normalized referrer lookup
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id),
  referrer_domain TEXT NOT NULL DEFAULT '(direct)',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  UNIQUE(site_id, referrer_domain, utm_source, utm_medium, utm_campaign)
);

CREATE TABLE devices (                -- normalized UA lookup, shared across sites
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  device_type TEXT NOT NULL,          -- desktop | mobile | tablet
  UNIQUE(browser, os, device_type)
);

CREATE TABLE locations (              -- from request.cf, shared across sites
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  region TEXT,
  city TEXT,
  UNIQUE(country, region, city)
);

CREATE TABLE events (                 -- custom events
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id),
  visit_id TEXT NOT NULL REFERENCES visits(id),
  name TEXT NOT NULL,
  props TEXT,                          -- JSON blob, small (<2KB)
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_events_site_name_ts ON events(site_id, name, timestamp);
```

### Rollup tables (written by cron, read by dashboard)

```sql
CREATE TABLE daily_summary (
  site_id TEXT NOT NULL,
  date TEXT NOT NULL,                 -- 'YYYY-MM-DD'
  visitors INTEGER NOT NULL,
  visits INTEGER NOT NULL,
  pageviews INTEGER NOT NULL,
  bounce_rate REAL NOT NULL,
  avg_duration_seconds REAL NOT NULL,
  PRIMARY KEY (site_id, date)
);

CREATE TABLE daily_pages (
  site_id TEXT NOT NULL, date TEXT NOT NULL, path TEXT NOT NULL,
  pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL,
  PRIMARY KEY (site_id, date, path)
);

CREATE TABLE daily_sources (
  site_id TEXT NOT NULL, date TEXT NOT NULL,
  referrer_domain TEXT NOT NULL, utm_source TEXT, utm_medium TEXT,
  visits INTEGER NOT NULL,
  PRIMARY KEY (site_id, date, referrer_domain, utm_source, utm_medium)
);

CREATE TABLE daily_devices (
  site_id TEXT NOT NULL, date TEXT NOT NULL,
  device_type TEXT NOT NULL, browser TEXT NOT NULL,
  visits INTEGER NOT NULL,
  PRIMARY KEY (site_id, date, device_type, browser)
);

CREATE TABLE daily_locations (
  site_id TEXT NOT NULL, date TEXT NOT NULL,
  country TEXT NOT NULL, city TEXT,
  visits INTEGER NOT NULL,
  PRIMARY KEY (site_id, date, country, city)
);

CREATE TABLE daily_events (
  site_id TEXT NOT NULL, date TEXT NOT NULL, name TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (site_id, date, name)
);
```

## 6. Ingestion Flow

`POST /collect` — called by a small tracking snippet, or `navigator.sendBeacon`.

Request body: `{ site_id, path, title, referrer, screen_w, screen_h }` (custom events: `{ site_id, name, props }`)

Worker logic per request:

1. Respond immediately with `204 No Content` (don't make the visitor wait on DB writes).
2. Inside `ctx.waitUntil(...)`:
   - Read `request.cf.country`, `request.cf.city`, `request.cf.region`, `CF-Connecting-IP`, `User-Agent`, `Referer`.
   - Compute `visitor_id` (§4). Upsert `visitors` row.
   - Parse UA into browser/os/device_type (lightweight parser — avoid a heavy `ua-parser-js` bundle; a trimmed regex-based parser keeps Worker bundle size down).
   - Resolve/insert `sources`, `devices`, `locations` lookup rows (`INSERT ... ON CONFLICT DO NOTHING` then `SELECT id`).
   - Find open visit for this visitor within the 30-min session window; update it, or create a new `visits` row.
   - Insert `pages` row.

This is ~4-6 small D1 queries per pageview. At the traffic levels in §9 that's nowhere near D1's throughput ceiling — no batching or Queues needed.

## 7. Aggregation (Cron Trigger)

Wrangler `[triggers] crons = ["10 0 * * *"]` — runs once daily.

For each site, for the just-completed UTC day:

- `GROUP BY` over `visits`/`pages`/`events` for that day → compute the 6 rollup rows shown in §5.
- Write with `INSERT OR REPLACE`, so a re-run (e.g. manual backfill) is always safe/idempotent.
- Runtime cost is trivial: even 10 sites × 3,300 events/day each is ~33k rows scanned once a day — a few seconds of Worker CPU at most, well inside a scheduled Worker's limits.

## 8. Dashboard & API

Single page per site (site switcher + date-range picker at the top, everything else on one scroll):
stat cards (visitors, visits, pageviews, bounce rate, avg duration) → time-series chart → top pages / top sources / devices / locations / events panels.

**Query rule:** any range that includes only _past, complete_ days reads exclusively from `daily_*` tables. Only "today" reads from raw tables. A "last 30 days" query is a `SUM()`/`GROUP BY` over ≤30 rollup rows — never a scan of the underlying events, whether the range is 30 days or 3 years.

```
GET  /api/sites                              list all sites            [Access]
GET  /api/sites/:id/summary?range=30d|6m|1y|custom                     [Access]
GET  /api/sites/:id/timeseries?range=...      for the chart             [Access]
GET  /api/sites/:id/pages?range=...                                     [Access]
GET  /api/sites/:id/sources?range=...                                   [Access]
GET  /api/sites/:id/devices?range=...                                   [Access]
GET  /api/sites/:id/locations?range=...                                 [Access]
GET  /api/sites/:id/events?range=...                                    [Access]
GET  /api/sites/:id/realtime/ws               WebSocket → LiveVisitors DO, §11  [Access]
POST /collect                                 ingestion                [public]
```

Everything the dashboard talks to sits behind Cloudflare Access (§10); only `/collect` is public, since it's called from visitors' browsers, not from you.

Frontend: static Nuxt/Vue single page, served as static assets from the Worker, calling the API above. Chart via a lightweight lib (uPlot or Chart.js) rather than a heavier charting framework, given it's one page with a handful of charts.

## 9. Sizing & Cost (at ~100k visits/month across all sites)

- ~3,300 pageviews/day average, realistically a few/sec at peak — far below D1's ~1,000 qps single-thread ceiling.
- Storage: ~300 bytes/pageview row → ~1 MB/day → ~30 MB/month → ~360 MB/year. You'd need decades of data to approach the 10 GB per-database cap.
- Rows written/month (raw + rollups) stay comfortably inside the Workers Paid plan's included 50M rows written / 25B rows read — you will not hit metered billing at this scale.
- **Conclusion: one D1 database, no sharding, no Analytics Engine, no Queues.** The rollup design in §7 is about keeping dashboard queries fast and flat as history grows over years, not about working around D1 throughput limits — at this traffic those limits are a non-issue.

### Full plan-limit picture (Workers Paid, $5/mo)

| Resource          | Included           | Overage rate           | This project (~100k visits/mo)       |
| ----------------- | ------------------ | ---------------------- | ------------------------------------ |
| Workers requests  | 10M/month          | $0.30/million          | ~150–300k/mo — ~2–3% of included     |
| Workers CPU time  | 30M CPU-ms/month   | $0.02/million ms       | negligible                           |
| D1 rows read      | 25B/month          | $0.001/million         | well under 1%                        |
| D1 rows written   | 50M/month          | $1.00/million          | ~300–500k/mo — ~1%                   |
| D1 storage        | 5 GB included      | small per-GB-month fee | ~30MB/mo/site — years of headroom    |
| DO requests (§11) | 1M/month           | $0.15/million          | ~50k–500k/mo depending on site count |
| DO duration (§11) | 400,000 GB-s/month | $12.50/million GB-s    | ~80–1,900 GB-s/mo — ~0.5% at most    |

The $5/mo subscription is the actual cost of running this, not a starter tier you'll outgrow — every metered dimension sits at low single-digit percentages of what's included. You'd need roughly 50–100x current traffic before any overage shows up, and even then it'd be cents. The one number that scales with _site count_ rather than traffic is DO requests (the per-site alarm) — worth a glance if you ever run dozens of sites, irrelevant at the scale this project targets.

## 10. Auth

Single owner, no user table needed.

**v1 decision: Cloudflare Access** in front of the dashboard/API routes — zero app code, login via Cloudflare's own auth (email OTP or IdP). No custom password/session logic to build or maintain.

Only `/collect` stays public — it's called from visitors' browsers, not from you. Every other route, including the dashboard's `/realtime/ws` connection to the `LiveVisitors` DO (§11), sits behind Access.

## 11. Real-Time Visitor Count (Durable Objects)

**Goal:** a live "N people on your site right now" number on the dashboard, pushed instantly rather than polled.

**Design:** one `LiveVisitors` Durable Object per site (not per visitor).

- The object holds a single in-memory `Map<visitor_id, lastSeenTimestamp>`. Nothing is written to the DO's durable storage — this is deliberately ephemeral, coordination-only state.
- On every pageview, the `/collect` Worker calls the site's DO (RPC or `fetch`) to upsert the visitor's timestamp in that map. This is in addition to, not instead of, the D1 write in §6 — the DO never touches D1.
- The dashboard opens a WebSocket to the DO. The DO pushes the current count whenever it changes — no client-side polling loop.
- A DO **alarm**, firing once a minute, sweeps the map for entries older than 5 minutes, drops them, and rebroadcasts the count to any connected WebSocket(s).
- Use the **WebSocket Hibernation API** (`state.acceptWebSocket()`, not manual `accept()`) so the object incurs no duration charges while a dashboard tab sits open with nothing happening — it only "wakes" to process a pageview ping or the once-a-minute alarm.

```
GET /api/sites/:id/realtime/ws     WebSocket upgrade → proxied to the site's LiveVisitors DO
```

**Cost, at ~100k visits/month across sites (see §9 for the full breakdown):** a rounding error. Outgoing WebSocket messages (the pushed count) are free; the alarm and pageview pings together land in the low tens-to-hundreds of thousands of requests/month and well under 2,000 GB-s of duration — both comfortably inside the Workers Paid plan's included Durable Objects allowance. The only line item that scales with anything other than traffic is the per-site alarm (43,200/month per site) — worth knowing if you ever run dozens of sites, irrelevant at the scale this project targets.

**v1 decision:** ship the Durable Object from the start — no polling fallback. (D1 polling remains a viable simpler alternative in general, just not the path taken here.)

# UI and Dashboard

This is a tanstack starte template I use for most of my projects. Its made wtih below, and it also has some reference code and examples - we can just remove it, no need of it.

1. D1 and Drizzle ORM - wrangler has an random db id and project name - remove it.
2. kumo-ui.com - component library from cloudflare, love their buttons and colors and especially layer card component, use kumo as much as possible, it has almost everything, charts, code blocks, dropdowns, buttons, popovers etc.
3. Phospor icons
4. It has R2, but I dont think we will need it.
5. For referrers - use this to show the website icons https://www.google.com/s2/favicons?domain=${domain}&sz=256 - the google favicon cache - works very well.
   1. For country icons - use this urls - https://api.iconify.design/circle-flags:in.svg or for example USA - https://api.iconify.design/circle-flags:us.svg
6. The dashboard should have max-w-3xl, very minimal two column design. And on top we show top metrics and in below wil be a chart, below will be the rest of the cards. They are all Layer Cards from kumo fyi
7. Main html/body to have bg-kumo-canvas - its a subtle neutral-100 colors (I think) so cards look good when placed.
8. I have attached some screenshots of the new analytics from Cloudflare - for reference, dont copy their metrics.
