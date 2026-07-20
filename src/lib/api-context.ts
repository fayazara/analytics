import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sites } from "@/db/schema"
import { isRangeKey, resolveRange, type ResolvedRange } from "@/lib/dates"

export interface ApiContext {
  site: typeof sites.$inferSelect
  resolved: ResolvedRange
}

/**
 * Shared setup for every `/api/sites/:id/...` handler: load the site (404
 * if missing) and resolve `?range=` (+ `?from=`/`?to=` for custom) into
 * concrete dates using the site's own timezone.
 */
export async function resolveSiteAndRange(
  request: Request,
  siteId: string,
): Promise<ApiContext | null> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1)
  if (!site) return null

  const url = new URL(request.url)
  const rangeParam = url.searchParams.get("range")
  const range = isRangeKey(rangeParam) ? rangeParam : "30d"
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  const resolved = resolveRange(range, site.timezone, from, to)

  return { site, resolved }
}
