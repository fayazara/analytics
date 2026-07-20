import { createFileRoute } from "@tanstack/react-router"
import { resolveSiteAndRange } from "@/lib/api-context"
import { computeTimeseries } from "@/lib/timeseries"

export const Route = createFileRoute("/api/sites/$siteId/timeseries")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await resolveSiteAndRange(request, params.siteId)
        if (!ctx) return Response.json({ error: "Site not found" }, { status: 404 })

        const points = await computeTimeseries(ctx.site, ctx.resolved)
        return Response.json({ range: ctx.resolved, points })
      },
    },
  },
})
