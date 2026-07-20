import { drizzle } from "drizzle-orm/d1"
import { env } from "cloudflare:workers"
import * as schema from "./schema"

/**
 * Drizzle client bound to the `DB` D1 binding (see wrangler.jsonc).
 *
 * Usage from a server function or API route handler:
 *
 *   import { db } from "@/db"
 *   import { items } from "@/db/schema"
 *
 *   const rows = await db.select().from(items).all()
 *
 * `cloudflare:workers` `env` is only available in server-side code
 * (server functions, API route handlers, middleware). Never import
 * this file from a client component.
 */
export const db = drizzle(env.DB, { schema })

export { schema }
