---
name: add-binding
description: >
  Adding a new Cloudflare binding (KV, R2, D1, Durable Object, Queue, secret,
  or environment variable) to this TanStack Start + Cloudflare Workers project.
  Use this skill whenever the user asks to add a binding, connect a new
  Cloudflare service, wire up KV/R2/D1/Queues, add a secret, or set an
  environment variable. Also trigger when the user says things like "I need
  caching" (KV), "add file storage" (R2), "set up a queue", "add a secret
  for my API key", "I need a new D1 database", or "add an env var". This
  skill covers the exact wrangler.jsonc configuration for each binding type,
  the cf-typegen step to get TypeScript types, and the usage patterns for
  accessing bindings via `import { env } from "cloudflare:workers"`.
---

# Skill: Add a Cloudflare Binding

## Workflow

### 1. Edit `wrangler.jsonc`

Add the binding configuration. Each binding type has its own top-level key:

#### KV Namespace

```jsonc
"kv_namespaces": [
  {
    "binding": "CACHE",
    "id": "<namespace-id>"   // from: npx wrangler kv namespace create CACHE
  }
]
```

#### R2 Bucket

```jsonc
"r2_buckets": [
  {
    "binding": "STORAGE",
    "bucket_name": "my-bucket"  // from: npx wrangler r2 bucket create my-bucket
  }
]
```

#### D1 Database

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "my-db",
    "database_id": "<database-id>",  // from: npx wrangler d1 create my-db
    "migrations_dir": "drizzle"
  }
]
```

#### Queue (Producer)

```jsonc
"queues": {
  "producers": [
    {
      "binding": "MY_QUEUE",
      "queue": "my-queue-name"
    }
  ]
}
```

#### Secret

Secrets are NOT declared in `wrangler.jsonc`. They are set via CLI:

```bash
npx wrangler secret put MY_SECRET          # production
# For local dev, add to .dev.vars:
# MY_SECRET="value"
```

#### Plain Variable (vars)

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "API_BASE_URL": "https://api.example.com"
}
```

### 2. Regenerate types

After editing `wrangler.jsonc`, always run:

```bash
npm run cf-typegen
```

This updates `worker-configuration.d.ts` so TypeScript knows about the
new binding. For example, after adding an R2 bucket with binding `STORAGE`,
`env.STORAGE` will be typed as `R2Bucket`.

### 3. Use the binding

Import `env` from `cloudflare:workers` in server-side code:

```ts
import { env } from "cloudflare:workers"
```

Usage patterns per binding type:

#### KV

```ts
// Write
await env.CACHE.put("user:123", JSON.stringify(userData), {
  expirationTtl: 3600, // seconds
})

// Read
const raw = await env.CACHE.get("user:123")
const data = raw ? JSON.parse(raw) : null

// Delete
await env.CACHE.delete("user:123")

// List keys
const list = await env.CACHE.list({ prefix: "user:" })
```

#### R2

```ts
// Upload
await env.STORAGE.put("photos/cat.jpg", fileBody, {
  httpMetadata: { contentType: "image/jpeg" },
})

// Download
const object = await env.STORAGE.get("photos/cat.jpg")
if (object) {
  const body = object.body // ReadableStream
  const contentType = object.httpMetadata?.contentType
}

// Delete
await env.STORAGE.delete("photos/cat.jpg")

// List
const listed = await env.STORAGE.list({ prefix: "photos/", limit: 100 })
```

#### D1 (raw, without Drizzle)

```ts
const { results } = await env.DB.prepare(
  "SELECT * FROM users WHERE id = ?"
).bind(userId).all()
```

But prefer the Drizzle wrapper (`import { db } from "@/db"`) for D1.

#### Queue

```ts
await env.MY_QUEUE.send({ type: "email", to: "user@example.com" })

// Send batch
await env.MY_QUEUE.sendBatch([
  { body: { type: "email", to: "a@example.com" } },
  { body: { type: "email", to: "b@example.com" } },
])
```

### 4. Create the resource (production)

For new projects, the resource must be created in Cloudflare before deploying:

```bash
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create my-bucket
npx wrangler d1 create my-db
```

Copy the printed IDs into `wrangler.jsonc`.

For local dev, most bindings work automatically with the Cloudflare Vite
plugin -- no remote resource needed. R2 and KV use local persistence in
`.wrangler/state/`.

### Reference examples in this template

- **D1**: `wrangler.jsonc` `d1_databases` + `src/db/index.ts`
- **R2**: `wrangler.jsonc` `r2_buckets` + `src/routes/api/files.ts`

### Common mistakes to avoid

- **Wrong**: Importing `env` in a client component. `cloudflare:workers`
  is server-only.
- **Wrong**: Passing `env` as a function argument. Import it where needed.
- **Wrong**: Using `process.env` for bindings. That's Node.js.
- **Wrong**: Forgetting to run `npm run cf-typegen` after editing
  `wrangler.jsonc`. TypeScript won't know about the new binding.
- **Wrong**: Putting secrets in `wrangler.jsonc`. Use `wrangler secret put`
  for production and `.dev.vars` for local dev.
