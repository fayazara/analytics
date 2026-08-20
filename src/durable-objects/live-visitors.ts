import { DurableObject } from "cloudflare:workers"
import type {
  RealtimeVisitorLocation,
  RealtimeVisitorsPayload,
} from "@/lib/realtime"

/**
 * LiveVisitors — one Durable Object per site (§11 of the spec).
 *
 * Holds a single in-memory `Map<visitorId, lastSeenMs>`. Nothing is
 * written to durable storage — this is deliberately ephemeral,
 * coordination-only state. The `/collect` Worker pings this object on
 * every pageview (in addition to, not instead of, the D1 write). The
 * dashboard opens a WebSocket (via the Hibernation API, so the object
 * incurs no duration charges while idle) and gets the live count pushed
 * whenever it changes, plus a rebroadcast every minute from the alarm
 * that sweeps stale (>5 min) visitors.
 */

const STALE_AFTER_MS = 5 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

export class LiveVisitors extends DurableObject<Env> {
  private lastSeen = new Map<
    string,
    {
      seenAt: number
      location: Omit<RealtimeVisitorLocation, "count"> | null
    }
  >()

  /** Called by `/collect` on every pageview for this site. */
  async ping(
    visitorId: string,
    location?: Omit<RealtimeVisitorLocation, "count">
  ): Promise<number> {
    const before = this.lastSeen.size
    const previous = this.lastSeen.get(visitorId)
    const nextLocation = location ?? null
    this.lastSeen.set(visitorId, {
      seenAt: Date.now(),
      location: nextLocation,
    })

    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS)
    }

    if (
      this.lastSeen.size !== before ||
      previous?.location?.latitude !== nextLocation?.latitude ||
      previous?.location?.longitude !== nextLocation?.longitude
    ) {
      this.broadcast()
    }
    return this.lastSeen.size
  }

  /**
   * Current live count, for callers that can't hold a WebSocket open.
   *
   * The miniapp dashboard polls this via `GET /ext/v1/sites/:id/realtime`
   * because the host-mediated HTTP transport is request/response only —
   * there's no WebSocket upgrade available to it. Read-only: it sweeps
   * stale visitors like the alarm does but never schedules one, so
   * polling an idle site can't keep the object awake.
   */
  async count(): Promise<number> {
    return this.sweepAndCount()
  }

  /** WebSocket upgrade — proxied here from `/api/sites/:id/realtime/ws`. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 })
    }

    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    this.sweepAndCount()
    pair[1].send(JSON.stringify(this.payload()))

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(): Promise<void> {
    // The dashboard doesn't send anything meaningful over the socket —
    // it's push-only. Nothing to do here.
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close()
    } catch {
      // already closed
    }
  }

  async webSocketError(): Promise<void> {
    // Hibernation API will clean up the socket; nothing else to do.
  }

  /** Fires once a minute (§11) while there's anything to track. */
  async alarm(): Promise<void> {
    const before = this.lastSeen.size
    const after = this.sweepAndCount()

    if (after !== before) this.broadcast()

    if (after > 0 || this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS)
    }
  }

  private sweepAndCount(): number {
    const cutoff = Date.now() - STALE_AFTER_MS
    for (const [visitorId, visitor] of this.lastSeen) {
      if (visitor.seenAt < cutoff) this.lastSeen.delete(visitorId)
    }
    return this.lastSeen.size
  }

  private broadcast(): void {
    const payload = JSON.stringify(this.payload())
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        // socket may have closed between getWebSockets() and send()
      }
    }
  }

  private payload(): RealtimeVisitorsPayload {
    const locations = new Map<string, RealtimeVisitorLocation>()

    for (const visitor of this.lastSeen.values()) {
      if (!visitor.location) continue
      const { latitude, longitude } = visitor.location
      const key = `${latitude}:${longitude}`
      const existing = locations.get(key)
      if (existing) {
        existing.count += 1
      } else {
        locations.set(key, { latitude, longitude, count: 1 })
      }
    }

    return {
      count: this.lastSeen.size,
      locations: Array.from(locations.values()).sort(
        (a, b) => b.count - a.count
      ),
    }
  }
}
