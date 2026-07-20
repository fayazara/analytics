import { defineConfig } from "drizzle-kit"

/**
 * Drizzle Kit only generates SQL migrations here.
 * Migrations are *applied* by wrangler using `npm run db:migrate`
 * (or `db:migrate:prod`), which reads `migrations_dir` from
 * wrangler.jsonc.
 *
 * Keep `out` pointing to the same directory that wrangler
 * is configured to use (default: ./drizzle).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
})
