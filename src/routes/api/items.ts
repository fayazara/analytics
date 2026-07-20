import { createFileRoute } from "@tanstack/react-router"
import { desc } from "drizzle-orm"
import { db } from "@/db"
import { insertItemSchema, items } from "@/db/schema"

/**
 * API route at `/api/items`.
 *
 * In TanStack Start, API routes are file-based routes that define
 * `server.handlers` instead of (or alongside) a `component`. Handlers
 * receive a Web `Request` and return a Web `Response`.
 *
 * The file lives at `src/routes/api/items.ts` so its URL is `/api/items`.
 * Use `$` segments for params, e.g. `src/routes/api/items.$id.ts`
 * → `/api/items/:id`.
 */
export const Route = createFileRoute("/api/items")({
  server: {
    handlers: {
      // GET /api/items → list items
      GET: async () => {
        const rows = await db
          .select()
          .from(items)
          .orderBy(desc(items.createdAt))
          .all()
        return Response.json(rows)
      },

      // POST /api/items → insert item
      // Body: { title: string, description?: string | null }
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json(
            { error: "Invalid JSON" },
            { status: 400 },
          )
        }

        const parsed = insertItemSchema.safeParse(body)
        if (!parsed.success) {
          return Response.json(
            { error: "Validation failed", issues: parsed.error.issues },
            { status: 400 },
          )
        }

        const [created] = await db
          .insert(items)
          .values(parsed.data)
          .returning()

        return Response.json(created, { status: 201 })
      },
    },
  },
})
