import { z } from "zod"

/**
 * `POST /collect` request body (§6). Either a pageview (`path` present) or
 * a custom event (`name` present).
 */
export const collectRequestSchema = z.object({
  site_id: z.string().min(1).max(64),
  // Pageview fields
  path: z.string().min(1).max(2048).optional(),
  title: z.string().max(500).optional().nullable(),
  referrer: z.string().max(2048).optional().nullable(),
  screen_w: z.number().int().positive().optional(),
  screen_h: z.number().int().positive().optional(),
  // Custom-event fields
  name: z.string().min(1).max(200).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
})

export type CollectRequest = z.infer<typeof collectRequestSchema>
