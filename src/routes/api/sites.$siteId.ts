import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sites } from "@/db/schema"

export const Route = createFileRoute("/api/sites/$siteId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const site = await db
          .select()
          .from(sites)
          .where(eq(sites.id, params.siteId))
          .limit(1)
          .get()
        if (!site) return Response.json({ error: "Not found" }, { status: 404 })
        return Response.json(site)
      },

      DELETE: async ({ params }) => {
        const site = await db
          .select({ id: sites.id })
          .from(sites)
          .where(eq(sites.id, params.siteId))
          .limit(1)
          .get()
        if (!site) return Response.json({ error: "Not found" }, { status: 404 })

        const bindDelete = (table: string) =>
          env.DB.prepare(`DELETE FROM ${table} WHERE site_id = ?`).bind(
            params.siteId
          )

        await env.DB.batch([
          bindDelete("events"),
          bindDelete("outbound_links"),
          bindDelete("pages"),
          bindDelete("visits"),
          bindDelete("visitors"),
          bindDelete("sources"),
          bindDelete("daily_summary"),
          bindDelete("daily_pages"),
          bindDelete("daily_sources"),
          bindDelete("daily_devices"),
          bindDelete("daily_locations"),
          bindDelete("daily_outbound_links"),
          bindDelete("daily_events"),
          env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(params.siteId),
        ])

        return new Response(null, { status: 204 })
      },
    },
  },
})
