# TanStack Start + Cloudflare Workers Template

A minimal, AI-agent-friendly starter for building full-stack apps on
Cloudflare Workers with TanStack Start.

> [!NOTE]
> This is a highly opinionated starter kit made specifically for agents.

> [!NOTE]
> This is a highly opinionated starter kit made specifically for agents and is still in beta; use carefully.
> This is still in betaaaaa, use carefully! blah blah blah 

**Includes:**

- TanStack Start (RC) on Vite, deployed as a Cloudflare Worker
- Cloudflare D1 binding wired up via `cloudflare:workers` `env`
- Drizzle ORM + Drizzle Kit for the schema, wrangler for migrations
- Example **server function** (`/`) — typed RPC for UI data
- Example **API route** (`/api/items`) — GET + POST with zod validation
- Tailwind v4 + shadcn/ui (Button preinstalled)
- An `AGENTS.md` that documents the patterns AI agents keep getting wrong

## First-time setup

```bash
# 1. install
pnpm install   # or npm / yarn

# 2. create your D1 database
npx wrangler d1 create tanstack-start-workers-template-db
# copy the printed database_id into wrangler.jsonc

# 3. generate + apply the example migration locally
npm run db:generate
npm run db:migrate

# 4. run it
npm run dev
```

Open http://localhost:3000 and try the curl examples on the page.

## Scripts

| script               | what it does                                           |
| -------------------- | ------------------------------------------------------ |
| `dev`                | Vite dev server with the Cloudflare plugin + local D1 (runs `db:migrate` first via `predev`) |
| `build`              | Production build                                       |
| `preview`            | Build + serve via `vite preview`                       |
| `deploy`             | Build + `wrangler deploy`                              |
| `cf-typegen`         | Regenerate `worker-configuration.d.ts` from wrangler   |
| `db:generate`        | Generate SQL migrations from `src/db/schema.ts`        |
| `db:migrate`         | Apply migrations to **local** D1                       |
| `db:migrate:prod`    | Apply migrations to **remote** D1                      |
| `db:studio`          | Open Drizzle Studio                                    |

## Project layout

```
src/
  db/
    schema.ts          # drizzle tables + drizzle-zod schemas
    index.ts           # drizzle client (uses env.DB)
  routes/
    __root.tsx
    index.tsx          # server function example
    api/
      items.ts         # API route (GET + POST)
  components/ui/       # shadcn components
  lib/utils.ts
drizzle/               # generated SQL migrations
wrangler.jsonc         # bindings + Worker config
drizzle.config.ts      # drizzle-kit config
AGENTS.md              # read this if you're an AI agent
```

## Why AGENTS.md?

TanStack Start and the Workers Vite plugin moved fast over 2025. Most LLMs
have stale training data — they'll generate old APIs like
`createServerFileRoute`, try to mount a Hono app inside the Worker entry,
or pass `env` around as a parameter. `AGENTS.md` documents what currently
works so an AI agent reading it gets the right patterns on the first try.

## Adding shadcn components

```bash
npx shadcn@latest add <component>
```
