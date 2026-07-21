# Personal Web Analytics

A self-hosted, cookieless, privacy-friendly web analytics tool for
personal projects — single owner, unlimited sites. Runs entirely on
Cloudflare Workers + D1 + Durable Objects. See
[`web-analytics-spec.md`](./web-analytics-spec.md) for the full design
doc (data model, session logic, sizing/cost, etc.) — this README is the
"how do I actually use it" version.

**Stack:** TanStack Start (Vite) on Cloudflare Workers, D1 (SQLite) via
Drizzle ORM, a Durable Object for the live-visitor count, a Cron Trigger
for daily rollups, Kumo (`@cloudflare/kumo`) for the dashboard UI.

## First-time setup

```bash
# 1. install
pnpm install   # or npm / yarn

# 2. create your D1 database
npx wrangler d1 create web-analytics-db
# copy the printed database_id into wrangler.jsonc → d1_databases[0].database_id

# 3. generate + apply migrations locally
npm run db:generate
npm run db:migrate

# 4. run it
npm run dev
```

Open http://localhost:3000 — you'll land on an empty state prompting you
to add your first site (name, domain, timezone). Once created, you get a
`site_id` (a uuid), which is what the tracking snippet needs.

> Local dev data lives in `.wrangler/state/` (D1 + the Durable Object).
> Want to populate the dashboard with realistic fake data instead of
> waiting on real traffic? See [Seeding demo data](#seeding-demo-data)
> below.

## Adding the tracking snippet to a site

Every site you track needs the tiny snippet from `public/script.js`
added to its pages. It's ~2KB, cookieless, and posts to `/collect` on
every pageview (plus SPA route changes via `pushState`/`replaceState`).

```html
<script
  defer
  src="https://analytics.fayazahmed.com/script.js"
  data-site="YOUR_SITE_ID"
></script>
```

- Use `http://localhost:3000/script.js` instead while developing locally.
- `data-site` is the `id` of the site you created (see it in the
  dashboard's site switcher, or `GET /api/sites`).
- That's the whole integration — no cookie banner needed, since nothing
  is stored client-side and visitor identity is derived server-side from
  `IP + User-Agent` (§4 of the spec).

### Tracking custom events

The snippet exposes a small global for one-off events (signups, clicks,
conversions, etc.):

```html
<script>
  window.wa.track("signup", { plan: "pro" })
</script>
```

`name` is required; `props` is an optional JSON-serializable object
(kept small — it's stored as a raw JSON blob per event).

## Dashboard

`http://localhost:3000/` (or your deployed URL) — one page, a site
switcher + date-range picker (`today` / `7d` / `30d` / `6m` / `1y`) at
the top, stat cards + chart + ranked lists (pages, sources, devices,
locations, custom events) below. Add more sites any time from the same
page (the `+` button next to the switcher).

Live visitor count (top-left badge) is pushed over a WebSocket from the
site's `LiveVisitors` Durable Object — no polling.

## API

Everything except `/collect` and static assets (`/script.js`) is meant
to sit behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
once deployed — this repo has no app-level auth (§10 of the spec). In
local dev, all routes are open.

| Route                        | Method             | Notes                                                   |
| ---------------------------- | ------------------ | ------------------------------------------------------- |
| `/collect`                   | `POST`             | **Public.** Ingestion — called by the tracking snippet. |
| `/api/sites`                 | `GET`, `POST`      | List / create sites.                                    |
| `/api/sites/:id`             | `GET`, `DELETE`    | Fetch / delete a site.                                  |
| `/api/sites/:id/summary`     | `GET`              | Stat-card totals for `?range=`.                         |
| `/api/sites/:id/timeseries`  | `GET`              | Chart data — daily points, or hourly for `range=today`. |
| `/api/sites/:id/pages`       | `GET`              | Top pages.                                              |
| `/api/sites/:id/sources`     | `GET`              | Top referrers/UTM sources.                              |
| `/api/sites/:id/devices`     | `GET`              | Top browser/device-type combos.                         |
| `/api/sites/:id/locations`   | `GET`              | Top country/city combos.                                |
| `/api/sites/:id/events`      | `GET`              | Top custom events.                                      |
| `/api/sites/:id/realtime/ws` | `GET` (WS upgrade) | Live visitor count, proxied to the `LiveVisitors` DO.   |

`range` accepts `today | 7d | 30d | 6m | 1y | custom` (custom takes
`from`/`to` as `YYYY-MM-DD`). Any range that doesn't include "today"
reads exclusively from the `daily_*` rollup tables — never a scan of raw
events, no matter how far back the range goes (§8).

## Daily aggregation

A Cron Trigger (`10 0 * * *`, see `wrangler.jsonc` → `triggers.crons`)
rolls the previous UTC day's raw rows into `daily_summary`/`daily_pages`/
`daily_sources`/`daily_devices`/`daily_locations`/`daily_events` for
every site (`src/lib/aggregate.ts`). It's idempotent (`INSERT ... ON
CONFLICT DO UPDATE`), so re-running it for an already-aggregated day is
safe.

Test it locally by hitting the scheduled handler:

```bash
curl "http://localhost:3000/cdn-cgi/handler/scheduled"
```

## Seeding demo data

For local dev, `scripts/seed-demo-data.mjs` generates realistic fake
traffic (real referrer domains, real cities/countries, real
browser/OS/device combos, a fictional SaaS site's pages, a handful of
custom events) — daily rollups for the past N days, plus raw rows for
"today":

```bash
node scripts/seed-demo-data.mjs <site-id> [days]   # default 90 days
npx wrangler d1 execute DB --local --file=./seed-output.sql
```

## Scripts

| script            | what it does                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `dev`             | Vite dev server with the Cloudflare plugin + local D1/DO (runs `db:migrate` first via `predev`) |
| `build`           | Production build                                                                                |
| `preview`         | Build + serve via `vite preview`                                                                |
| `deploy`          | Build + `wrangler deploy`                                                                       |
| `cf-typegen`      | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc`                                    |
| `db:generate`     | Generate SQL migrations from `src/db/schema.ts`                                                 |
| `db:migrate`      | Apply migrations to **local** D1                                                                |
| `db:migrate:prod` | Apply migrations to **remote** D1                                                               |
| `db:studio`       | Open Drizzle Studio                                                                             |
| `typecheck`       | `tsc --noEmit`                                                                                  |

## Project layout

```
src/
  server.ts                 # custom Worker entry — fetch + scheduled (cron) + exports the DO
  durable-objects/
    live-visitors.ts         # LiveVisitors DO — live visitor count over WebSocket (Hibernation API)
  db/
    schema.ts                # raw tables + daily_* rollup tables (drizzle)
    index.ts                 # drizzle client (uses env.DB)
  lib/
    aggregate.ts              # cron: rolls raw tables into daily_* rollups
    api-context.ts            # shared "load site + resolve ?range=" helper for API routes
    collect-schema.ts         # zod schema for POST /collect
    dates.ts                  # timezone-aware date-range resolution
    echarts.ts                # central ECharts module registration
    format.ts                 # number/duration/percent formatting
    geo.ts                    # reads request.cf for country/region/city
    lookups.ts                # resolves/inserts sources/devices/locations lookup rows
    raw-stats.ts              # aggregates raw tables for "today"
    session.ts                # 30-min session window / visit upsert logic
    summary.ts, timeseries.ts, top-lists.ts   # dashboard query logic
    ua.ts                     # lightweight User-Agent parser
    visitor-id.ts             # sha256(site_id + IP + UA) — cookieless visitor id
  components/dashboard/       # dashboard-only UI (kumo-based)
  hooks/use-live-visitors.ts  # WebSocket hook for the live-visitor badge
  routes/
    __root.tsx
    index.tsx                 # the dashboard (single page)
    collect.ts                 # POST /collect — public ingestion route
    api/
      sites.ts, sites.$siteId.ts
      sites.$siteId.summary.ts, .timeseries.ts, .pages.ts, .sources.ts,
      .devices.ts, .locations.ts, .events.ts, .realtime.ws.ts
public/
  script.js                  # the tracking snippet — see "Adding the tracking snippet" above
scripts/
  seed-demo-data.mjs         # generates realistic fake traffic for local dev
drizzle/                     # generated SQL migrations
wrangler.jsonc                # bindings (D1, Durable Object), cron trigger, Worker config
web-analytics-spec.md         # the full design spec this app implements
```

## Deploying

```bash
npm run deploy
```

Before your first deploy:

1. Create the D1 database (`npx wrangler d1 create web-analytics-db`) and
   put the `database_id` in `wrangler.jsonc`.
2. Apply migrations to the remote DB: `npm run db:migrate:prod`.
3. Put the Worker's routes behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) —
   every route except `/collect` and `/script.js` (§10 of the spec).
   This app has no built-in auth by design.

The `LiveVisitors` Durable Object and the daily cron trigger are already
declared in `wrangler.jsonc` — nothing else to configure for those.
