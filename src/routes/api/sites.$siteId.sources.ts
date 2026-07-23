import { createFileRoute } from "@tanstack/react-router"
import type { SourceDimension } from "@/lib/top-lists"
import { resolveSiteAndRange } from "@/lib/api-context"
import { computeTopSources } from "@/lib/top-lists"

export const Route = createFileRoute("/api/sites/$siteId/sources")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await resolveSiteAndRange(request, params.siteId)
        if (!ctx)
          return Response.json({ error: "Site not found" }, { status: 404 })

        const view = new URL(request.url).searchParams.get("view")
        const dimension: SourceDimension =
          view === "links" || view === "utm" ? view : "referrer"
        const result = await computeTopSources(
          ctx.site,
          ctx.resolved,
          dimension
        )
        return Response.json({ range: ctx.resolved, ...result })
      },
    },
  },
})
