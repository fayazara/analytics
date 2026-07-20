import { createFileRoute } from "@tanstack/react-router"
import { resolveSiteAndRange } from "@/lib/api-context"
import { computeSummary } from "@/lib/summary"

export const Route = createFileRoute("/api/sites/$siteId/summary")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await resolveSiteAndRange(request, params.siteId)
        if (!ctx) return Response.json({ error: "Site not found" }, { status: 404 })

        const summary = await computeSummary(ctx.site, ctx.resolved)
        return Response.json({ range: ctx.resolved, ...summary })
      },
    },
  },
})
