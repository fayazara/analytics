import { useEffect, useRef, useState } from "react"

/**
 * Opens a WebSocket to the site's `LiveVisitors` Durable Object (§11) and
 * returns the live visitor count, pushed by the server — no polling.
 */
export function useLiveVisitorCount(siteId: string | undefined): number | null {
  const [count, setCount] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    setCount(null)
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
          const data = JSON.parse(event.data as string) as { count?: number }
          if (typeof data.count === "number") setCount(data.count)
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

  return count
}
