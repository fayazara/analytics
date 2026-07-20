import { createFileRoute } from "@tanstack/react-router"
import { resolveSiteAndRange } from "@/lib/api-context"
import { computeTopSources } from "@/lib/top-lists"

export const Route = createFileRoute("/api/sites/$siteId/sources")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await resolveSiteAndRange(request, params.siteId)
        if (!ctx) return Response.json({ error: "Site not found" }, { status: 404 })

        const rows = await computeTopSources(ctx.site, ctx.resolved)
        return Response.json({ range: ctx.resolved, rows })
      },
    },
  },
})
