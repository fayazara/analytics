/**
 * Personal Web Analytics — tracking snippet.
 *
 * Usage:
 *   <script defer src="https://your-worker.example.com/script.js" data-site="SITE_ID"></script>
 *
 * Custom events:
 *   window.wa.track("signup", { plan: "pro" })
 *
 * Cookieless (§4 of the spec) — nothing is read from or written to
 * localStorage/cookies. The server derives visitor identity from
 * IP + User-Agent.
 */
;(function () {
  "use strict"

  var currentScript = document.currentScript
  if (!currentScript) return

  var siteId = currentScript.getAttribute("data-site")
  if (!siteId) return

  var endpoint = new URL("/collect", currentScript.src).toString()
  var lastPath = null

  function send(payload) {
    var body = JSON.stringify(payload)
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))
        return
      }
    } catch (_err) {
      // fall through to fetch
    }
    fetch(endpoint, {
      method: "POST",
      body: body,
      keepalive: true,
      headers: { "Content-Type": "text/plain" },
    }).catch(function () {})
  }

  function trackPageview() {
    var path = location.pathname + location.search
    if (path === lastPath) return
    lastPath = path

    send({
      site_id: siteId,
      path: path,
      title: document.title,
      referrer: document.referrer || null,
      screen_w: window.screen ? window.screen.width : undefined,
      screen_h: window.screen ? window.screen.height : undefined,
    })
  }

  function trackEvent(name, props) {
    if (!name) return
    send({ site_id: siteId, name: String(name), props: props || undefined })
  }

  // SPA route-change detection — most client-side routers call
  // pushState/replaceState on navigation.
  var originalPushState = history.pushState
  var originalReplaceState = history.replaceState

  history.pushState = function () {
    originalPushState.apply(this, arguments)
    trackPageview()
  }
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments)
    trackPageview()
  }
  window.addEventListener("popstate", trackPageview)

  // Public API for custom events (§6).
  window.wa = { track: trackEvent }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    trackPageview()
  } else {
    document.addEventListener("DOMContentLoaded", trackPageview)
  }
})()
