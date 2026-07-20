import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"

/**
 * API route at `/api/files`.
 *
 * Demonstrates R2 object storage via the `STORAGE` binding (see wrangler.jsonc).
 *
 * - PUT  /api/files?key=photos/cat.jpg  — upload (body = raw file)
 * - GET  /api/files?key=photos/cat.jpg  — download
 * - DELETE /api/files?key=photos/cat.jpg — delete
 * - GET  /api/files                      — list all objects (prefix optional)
 *
 * `cloudflare:workers` env is only available server-side. This file only
 * defines `server.handlers`, so it never runs in the browser.
 */
export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      // GET /api/files?key=... → download object (or list if no key)
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const key = url.searchParams.get("key")

        // No key → list objects
        if (!key) {
          const prefix = url.searchParams.get("prefix") ?? undefined
          const listed = await env.STORAGE.list({ prefix, limit: 100 })
          return Response.json({
            objects: listed.objects.map((o) => ({
              key: o.key,
              size: o.size,
              uploaded: o.uploaded,
            })),
            truncated: listed.truncated,
          })
        }

        // Key provided → download object
        const object = await env.STORAGE.get(key)
        if (!object) {
          return Response.json({ error: "Not found" }, { status: 404 })
        }

        return new Response(object.body, {
          headers: {
            "content-type":
              object.httpMetadata?.contentType ??
              "application/octet-stream",
            etag: object.httpEtag,
          },
        })
      },

      // PUT /api/files?key=... → upload object (body = raw file bytes)
      PUT: async ({ request }) => {
        const url = new URL(request.url)
        const key = url.searchParams.get("key")
        if (!key) {
          return Response.json(
            { error: "Missing ?key= parameter" },
            { status: 400 },
          )
        }

        const contentType = request.headers.get("content-type") ?? undefined
        const object = await env.STORAGE.put(key, request.body, {
          httpMetadata: contentType ? { contentType } : undefined,
        })

        return Response.json(
          { key: object.key, size: object.size, uploaded: object.uploaded },
          { status: 201 },
        )
      },

      // DELETE /api/files?key=... → delete object
      DELETE: async ({ request }) => {
        const url = new URL(request.url)
        const key = url.searchParams.get("key")
        if (!key) {
          return Response.json(
            { error: "Missing ?key= parameter" },
            { status: 400 },
          )
        }

        await env.STORAGE.delete(key)
        return new Response(null, { status: 204 })
      },
    },
  },
})
