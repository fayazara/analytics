# Agent Instructions

This is a **TanStack Start + Cloudflare Workers** template. Read this whole
file before generating code. The patterns here are the ones that work — most
AI training data is out of date for both frameworks.

## Stack

- **TanStack Start** (RC) — full-stack React on Vite, file-based routing
- **Cloudflare Workers** as the runtime (not Node, not Pages)
- **Cloudflare D1** (SQLite) as the database
- **Cloudflare R2** for object/file storage
- **Drizzle ORM** + **Drizzle Kit** for schema and migrations
- **Zod** for input validation (`drizzle-zod` for table-derived schemas)
- **Tailwind v4** + **Kumo** (`@cloudflare/kumo`) for UI
- **Phosphor Icons** (`@phosphor-icons/react`) for icons — Kumo's
  recommended icon set

## Skills

This template includes agent skills for common workflows. Load a skill
when the task matches — it will give you the exact steps and patterns.

| Skill | When to use |
|---|---|
| `new-api-route` | Creating a new HTTP endpoint (REST route) |
| `new-db-table` | Adding a table, modifying the schema, creating a model |
| `add-binding` | Adding a Cloudflare binding (KV, R2, D1, Queue, secret, var) |

## How bindings work — read this first

Bindings (D1, KV, R2, secrets, vars) are declared in `wrangler.jsonc` and
accessed on the **server only** via:

```ts
import { env } from "cloudflare:workers"

env.DB      // D1Database
env.STORAGE // R2Bucket
```

Rules:

- `cloudflare:workers` is a **virtual module**. Only import it from
  server-only code: server functions, API route `server.handlers`,
  middleware. Never from a client component or anything that runs in the
  browser.
- Do **not** pass `env` through function arguments. Import it where you
  need it. Top-level `import { env } from "cloudflare:workers"` is the
  blessed pattern.
- After editing `wrangler.jsonc`, run `npm run cf-typegen` to refresh
  `worker-configuration.d.ts` so `env.DB` and `env.STORAGE` are typed.

The Drizzle client in `src/db/index.ts` already wraps `env.DB`:

```ts
import { db } from "@/db"
import { items } from "@/db/schema"

await db.select().from(items).all()
```

## Server functions vs API routes

This template ships both. They are different things. Pick correctly.

### Server functions — `createServerFn`

Use for data the **app's own UI** consumes. They are typed RPCs, not URLs.

```ts
// src/routes/index.tsx
import { createServerFn } from "@tanstack/react-start"

const getItems = createServerFn().handler(async () => {
  return await db.select().from(items).all()
})

export const Route = createFileRoute("/")({
  loader: () => getItems(),
  component: App,
})
```

- Called like `getItems()` from a loader/component.
- Inputs validated via `.inputValidator(...)` / `.validator(...)`.
- No URL to think about, no manual `fetch`.

### API routes — file-based, `server.handlers`

Use for **external HTTP callers**: curl, mobile apps, webhooks, anything
that needs a stable URL + verb.

```ts
// src/routes/api/items.ts  →  /api/items
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/items")({
  server: {
    handlers: {
      GET: async ({ request }) => Response.json([]),
      POST: async ({ request }) => {
        const body = await request.json()
        return Response.json(body, { status: 201 })
      },
    },
  },
})
```

- File path → URL. `src/routes/api/items.$id.ts` → `/api/items/:id`.
- Handlers take `{ request, params }` and return a Web `Response`.
- **No** `component` field needed if it's a pure API route.

### What NOT to do

- Don't write `createServerFileRoute(...)`. That's an old API. Use
  `createFileRoute(...).server.handlers`.
- Don't write a Hono/Express app inside the Worker entry. TanStack Start's
  server entry already handles routing — just add a file route.
- Don't import `process.env` for bindings. It won't work.
- Don't pass `env` as a parameter. Import it.

## Database workflow

The schema lives in `src/db/schema.ts`. To change it:

```bash
# 1. edit src/db/schema.ts
npm run db:generate       # writes SQL to ./drizzle/
npm run db:migrate        # applies to LOCAL D1 (default for dev)
npm run db:migrate:prod   # applies to REMOTE D1 (production)
```

Notes:

- Migrations live in `./drizzle/` and are applied by **wrangler**, not by
  drizzle-kit. This is intentional — D1 has its own migrations system and
  we want a single source of truth.
- `db:migrate` is `wrangler d1 migrations apply DB --local`. Local D1 data
  lives in `.wrangler/state/`.
- First-time setup requires creating the D1 database:
  ```bash
  npx wrangler d1 create tanstack-start-workers-template-db
  ```
  Then paste the printed `database_id` into `wrangler.jsonc`.

## R2 object storage

The `STORAGE` R2 bucket binding is declared in `wrangler.jsonc`. Use it
for file uploads, user content, generated assets, etc.

```ts
import { env } from "cloudflare:workers"

// Upload
await env.STORAGE.put("photos/cat.jpg", fileBody, {
  httpMetadata: { contentType: "image/jpeg" },
})

// Download
const object = await env.STORAGE.get("photos/cat.jpg")
if (object) {
  // object.body is a ReadableStream
  // object.httpMetadata?.contentType for MIME type
}

// Delete
await env.STORAGE.delete("photos/cat.jpg")

// List
const listed = await env.STORAGE.list({ prefix: "photos/", limit: 100 })
```

See `src/routes/api/files.ts` for a complete API route with GET (list +
download), PUT (upload), and DELETE.

First-time setup requires creating the bucket:
```bash
npx wrangler r2 bucket create tanstack-start-workers-template-storage
```

## Validation

Use `drizzle-zod` to derive zod schemas from the drizzle table, then
validate request bodies with `.safeParse(...)`. See
`src/routes/api/items.ts` for the canonical POST pattern (parse JSON,
validate, return 400 with issues on failure, insert with `.returning()`
on success).

## Local dev

```bash
npm run dev      # vite dev on :3000, with cloudflare plugin + local D1/R2
npm run build    # production build
npm run preview  # build + vite preview (runs on workerd locally)
npm run deploy   # build + wrangler deploy
```

`npm run dev` is the one to use 99% of the time. It runs the full Worker
runtime via `@cloudflare/vite-plugin`, so bindings (D1, R2, etc.) work
the same way they will in production.

There is a `predev` hook that runs `db:migrate` automatically before
`dev` starts, so local D1 is always in sync with whatever migrations
exist in `./drizzle/`. If you generate a new migration with
`db:generate`, the next `npm run dev` will apply it for you.

## Paths

- `@/*` → `./src/*`

## Cloudflare docs

When you need documentation for **any** Cloudflare product (Workers, D1,
R2, KV, Queues, Durable Objects, AI, etc.), use the Cloudflare docs MCP
instead of relying on training data. Cloudflare APIs move fast and your
training data is likely stale.

If the MCP is available, query it directly. If not, tell the user to add
it to their MCP config:

```json
{
  "mcpServers": {
    "cloudflare-api": {
      "url": "https://mcp.cloudflare.com/mcp"
    }
  }
}
```

This gives you access to the full Cloudflare developer documentation.
Always prefer it over guessing.

## When in doubt

- Check `src/routes/index.tsx` for a server-function example
- Check `src/routes/api/items.ts` for a D1 API-route example
- Check `src/routes/api/files.ts` for an R2 API-route example
- Check `src/db/schema.ts` for table + zod schema patterns
- Check `wrangler.jsonc` for how bindings are declared
