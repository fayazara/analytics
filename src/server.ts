import handler from "@tanstack/react-start/server-entry"
import { runDailyAggregation } from "@/lib/aggregate"

export { LiveVisitors } from "@/durable-objects/live-visitors"

export default {
  fetch: handler.fetch,

  // Daily rollup cron (§7) — see wrangler.jsonc `triggers.crons`.
  async scheduled(_event: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyAggregation())
  },
}
