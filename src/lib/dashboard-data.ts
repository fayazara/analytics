import { env } from "cloudflare:workers"
import { asc } from "drizzle-orm"
import { db } from "@/db"
import { sites } from "@/db/schema"

export async function loadDashboardData() {
  return {
    sites: await db.select().from(sites).orderBy(asc(sites.name)).all(),
    trackerOrigin: new URL(env.TRACKER_ORIGIN).origin,
  }
}
