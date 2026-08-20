import { useEffect, useRef, useState } from "react"
import type { RealtimeVisitorsPayload } from "@/lib/realtime"

/**
 * Opens a WebSocket to the site's `LiveVisitors` Durable Object (§11) and
 * returns the live visitor count and approximate locations, pushed by the
 * server — no polling.
 */
export function useLiveVisitors(siteId: string | undefined): {
  count: number | null
  locations: RealtimeVisitorsPayload["locations"]
} {
  const [state, setState] = useState<{
    count: number | null
    locations: RealtimeVisitorsPayload["locations"]
  }>({ count: null, locations: [] })
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    setState({ count: null, locations: [] })
    if (!siteId) return

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      if (cancelled || typeof window === "undefined") return
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const url = `${protocol}//${window.location.host}/api/sites/${siteId}/realtime/ws`

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(
            event.data as string
          ) as Partial<RealtimeVisitorsPayload>
          if (typeof data.count === "number") {
            setState({
              count: data.count,
              locations: Array.isArray(data.locations) ? data.locations : [],
            })
          }
        } catch {
          // ignore malformed frame
        }
      }
      ws.onclose = () => {
        if (!cancelled) retryTimer = setTimeout(connect, 5000)
      }
      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [siteId])

  return state
}
