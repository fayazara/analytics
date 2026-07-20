---
name: new-db-table
description: >
  Adding a database table, modifying the schema, or creating a new
  model/entity in this TanStack Start + Cloudflare D1 project. Use this skill
  whenever the user asks to add a table, create a model, define a new entity,
  add columns, change the schema, or anything involving `src/db/schema.ts`.
  Also trigger when the user says things like "I need a users table", "add a
  posts model", "store X in the database", "add a field to...", or "set up
  the DB for...". This skill covers Drizzle ORM column types for SQLite/D1,
  the migration workflow (generate then apply via wrangler), Zod schema
  derivation with drizzle-zod, and common pitfalls like using Postgres types
  on D1.
---

# Skill: Create a New Database Table

## Workflow

### 1. Add the table to `src/db/schema.ts`

All tables live in a single file. Use Drizzle's SQLite column builders:

```ts
import { sql } from "drizzle-orm"
import { int, sqliteTable, text, real, blob } from "drizzle-orm/sqlite-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import type { z } from "zod"

export const posts = sqliteTable("posts", {
  id: int("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: int("author_id").notNull(),
  publishedAt: int("published_at", { mode: "timestamp" }),
  createdAt: int("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})
```

Common column patterns for D1 (SQLite):
- **Primary key**: `int("id").primaryKey({ autoIncrement: true })`
- **Text**: `text("name").notNull()`
- **Nullable text**: `text("bio")` (nullable by default)
- **Integer**: `int("count").notNull().default(0)`
- **Timestamp**: `int("created_at", { mode: "timestamp" }).notNull().default(sql\`(unixepoch())\`)`
- **Boolean (as int)**: `int("is_active", { mode: "boolean" }).notNull().default(true)`
- **Real/Float**: `real("price").notNull()`
- **JSON stored as text**: `text("metadata", { mode: "json" })`

### 2. Export types and Zod schemas

Always export these alongside the table:

```ts
// Inferred types
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert

// Zod schemas for validation
export const selectPostSchema = createSelectSchema(posts)
export const insertPostSchema = createInsertSchema(posts, {
  title: (s) => s.min(1).max(200),
  body: (s) => s.min(1).max(50000),
}).pick({ title: true, body: true, authorId: true })

export type InsertPostInput = z.infer<typeof insertPostSchema>
```

The `.pick()` call is important -- it restricts which fields the insert
schema accepts. Don't let callers set `id`, `createdAt`, or other
server-managed fields.

### 3. Generate and apply the migration

Run these commands in order:

```bash
npm run db:generate       # Creates SQL migration in ./drizzle/
npm run db:migrate        # Applies to LOCAL D1
```

For production:
```bash
npm run db:migrate:prod   # Applies to REMOTE D1
```

The `predev` hook runs `db:migrate` automatically, so if you're about to
`npm run dev`, the local migration will be applied for you.

### 4. Use the table

From a server function or API route:

```ts
import { db } from "@/db"
import { posts } from "@/db/schema"
import { eq, desc } from "drizzle-orm"

// Select all
const allPosts = await db.select().from(posts).all()

// Select with filter
const userPosts = await db.select().from(posts)
  .where(eq(posts.authorId, userId))
  .orderBy(desc(posts.createdAt))
  .all()

// Insert
const [created] = await db.insert(posts)
  .values({ title: "Hello", body: "World", authorId: 1 })
  .returning()

// Update
await db.update(posts)
  .set({ title: "Updated" })
  .where(eq(posts.id, postId))

// Delete
await db.delete(posts).where(eq(posts.id, postId))
```

### 5. Reference example

See `src/db/schema.ts` for the `items` table -- it's the canonical
example of table + types + zod schemas.

### Common mistakes to avoid

- **Wrong**: Using `varchar` or `serial` -- those are Postgres. D1 is
  SQLite. Use `text` and `int` with `autoIncrement`.
- **Wrong**: Forgetting `{ mode: "timestamp" }` on integer timestamp
  columns -- without it, Drizzle treats them as plain numbers.
- **Wrong**: Running `drizzle-kit push` -- we don't push, we generate
  migrations and apply them with wrangler.
- **Wrong**: Editing migration files by hand after they've been applied.
  Generate a new migration instead.
- **Wrong**: Importing `db` from a client component. It uses
  `cloudflare:workers` which is server-only.
