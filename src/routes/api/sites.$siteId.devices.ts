import { createFileRoute } from "@tanstack/react-router"
import type { DeviceDimension } from "@/lib/top-lists"
import { resolveSiteAndRange } from "@/lib/api-context"
import { computeTopDevices } from "@/lib/top-lists"

export const Route = createFileRoute("/api/sites/$siteId/devices")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await resolveSiteAndRange(request, params.siteId)
        if (!ctx)
          return Response.json({ error: "Site not found" }, { status: 404 })

        const view = new URL(request.url).searchParams.get("view")
        const dimension: DeviceDimension =
          view === "os" || view === "device" ? view : "browser"
        const result = await computeTopDevices(
          ctx.site,
          ctx.resolved,
          dimension
        )
        return Response.json({ range: ctx.resolved, ...result })
      },
    },
  },
})
