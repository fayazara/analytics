import { sql } from "drizzle-orm"
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import type { z } from "zod"

/**
 * Example `items` table.
 *
 * After editing this file:
 *   1. `npm run db:generate` — creates SQL in ./drizzle
 *   2. `npm run db:migrate`  — applies it to local D1
 *   3. `npm run db:migrate:prod` — applies it to remote D1
 */
export const items = sqliteTable("items", {
  id: int("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  createdAt: int("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert

// Zod schemas derived from the drizzle table.
// `insertItemSchema` is what the POST /api/items handler validates against.
export const selectItemSchema = createSelectSchema(items)
export const insertItemSchema = createInsertSchema(items, {
  title: (schema) => schema.min(1).max(200),
  description: (schema) => schema.max(2000).nullish(),
}).pick({ title: true, description: true })

export type InsertItemInput = z.infer<typeof insertItemSchema>
