import { createFileRoute } from "@tanstack/react-router"
import { resolveSiteAndRange } from "@/lib/api-context"
import { computeTopLocations } from "@/lib/top-lists"

export const Route = createFileRoute("/api/sites/$siteId/locations")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await resolveSiteAndRange(request, params.siteId)
        if (!ctx) return Response.json({ error: "Site not found" }, { status: 404 })

        const rows = await computeTopLocations(ctx.site, ctx.resolved)
        return Response.json({ range: ctx.resolved, rows })
      },
    },
  },
})
