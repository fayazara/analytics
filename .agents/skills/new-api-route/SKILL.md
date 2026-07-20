---
name: new-api-route
description: >
  Creating a new HTTP endpoint (REST route) in this TanStack Start +
  Cloudflare Workers project. Use this skill whenever the user asks to add an
  API route, REST endpoint, HTTP handler, webhook receiver, or any new URL
  that external callers can hit. Also trigger when the user says things like
  "add a GET/POST/PUT/DELETE for...", "create an endpoint for...", "I need an
  API for...", "add a route at /api/...", or even just "expose this over HTTP".
  This skill covers the exact file-based routing pattern, handler structure,
  input validation, and binding access that work in this codebase -- most AI
  training data gets TanStack Start's API routes wrong.
---

# Skill: Create a New API Route

## Workflow

### 1. Decide the URL shape

TanStack Start uses **file-based routing**. The file path determines the URL:

| File path | URL |
|---|---|
| `src/routes/api/items.ts` | `/api/items` |
| `src/routes/api/items.$id.ts` | `/api/items/:id` |
| `src/routes/api/users.$userId.posts.ts` | `/api/users/:userId/posts` |

Use `$` for dynamic segments. The param name after `$` becomes the key in
`params`.

### 2. Create the route file

Every API route follows this exact structure:

```ts
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/your-path")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        // params.id if the file uses .$id segment
        return Response.json({ hello: "world" })
      },

      POST: async ({ request }) => {
        const body = await request.json()
        return Response.json(body, { status: 201 })
      },
    },
  },
})
```

Key rules:
- The string in `createFileRoute("/api/your-path")` **must** match the file
  path exactly. `src/routes/api/items.$id.ts` uses
  `createFileRoute("/api/items/$id")`.
- Handlers receive `{ request, params }` and return a Web `Response`.
- No `component` field is needed for pure API routes.
- Available HTTP methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.

### 3. Access bindings (D1, R2, etc.)

Import from `cloudflare:workers` at the top of the file:

```ts
import { env } from "cloudflare:workers"

// then in a handler:
const rows = await env.DB.prepare("SELECT 1").all()
const object = await env.STORAGE.get("key")
```

Or use the Drizzle wrapper for D1:

```ts
import { db } from "@/db"
import { items } from "@/db/schema"

const rows = await db.select().from(items).all()
```

### 4. Validate input

For POST/PUT/PATCH, always validate the body:

```ts
import { z } from "zod"

const bodySchema = z.object({
  title: z.string().min(1).max(200),
})

POST: async ({ request }) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  // parsed.data is typed and safe
}
```

If the data maps to a DB table, prefer `drizzle-zod`:

```ts
import { createInsertSchema } from "drizzle-zod"
import { items } from "@/db/schema"

const insertSchema = createInsertSchema(items, {
  title: (s) => s.min(1).max(200),
}).pick({ title: true, description: true })
```

### 5. Reference examples in this template

- **D1 CRUD**: `src/routes/api/items.ts` -- GET list, POST with validation
- **R2 files**: `src/routes/api/files.ts` -- GET/PUT/DELETE with key param

### Common mistakes to avoid

- **Wrong**: `createServerFileRoute(...)` -- that's an old API.
- **Wrong**: Importing `process.env` -- use `import { env } from "cloudflare:workers"`.
- **Wrong**: Passing `env` as a function argument -- import it directly.
- **Wrong**: Adding a `component` export to a pure API route file.
- **Wrong**: Forgetting the route string must match the file path.
