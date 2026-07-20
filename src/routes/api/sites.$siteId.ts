import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sites } from "@/db/schema"

export const Route = createFileRoute("/api/sites/$siteId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [site] = await db
          .select()
          .from(sites)
          .where(eq(sites.id, params.siteId))
          .limit(1)
        if (!site) return Response.json({ error: "Not found" }, { status: 404 })
        return Response.json(site)
      },

      DELETE: async ({ params }) => {
        await db.delete(sites).where(eq(sites.id, params.siteId))
        return new Response(null, { status: 204 })
      },
    },
  },
})
