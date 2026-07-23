import { createFileRoute } from "@tanstack/react-router"
import type { PageDimension } from "@/lib/top-lists"
import { resolveSiteAndRange } from "@/lib/api-context"
import { computeTopPages } from "@/lib/top-lists"

export const Route = createFileRoute("/api/sites/$siteId/pages")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await resolveSiteAndRange(request, params.siteId)
        if (!ctx)
          return Response.json({ error: "Site not found" }, { status: 404 })

        const view = new URL(request.url).searchParams.get("view")
        const dimension: PageDimension =
          view === "entered" || view === "exited" ? view : "top"
        const result = await computeTopPages(ctx.site, ctx.resolved, dimension)
        return Response.json({ range: ctx.resolved, ...result })
      },
    },
  },
})
