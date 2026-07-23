/**
 * Personal Web Analytics — tracking snippet.
 *
 * Usage:
 *   <script defer src="https://analytics.fayazahmed.com/script.js" data-site="SITE_ID"></script>
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
      if (
        navigator.sendBeacon &&
        navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))
      ) {
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

  function referrerHostname() {
    if (!document.referrer) return null
    try {
      return new URL(document.referrer).hostname || null
    } catch (_err) {
      return null
    }
  }

  function trackPageview() {
    // Query strings and hashes may contain sensitive values and create a
    // separate analytics row for every parameter combination. Campaign
    // parameters are allowlisted below instead of being included in `path`.
    var path = location.pathname || "/"
    if (path === lastPath) return
    lastPath = path

    var search = new URLSearchParams(location.search)
    var payload = {
      site_id: siteId,
      path: path,
      title: document.title,
      referrer: referrerHostname(),
    }

    var utmSource = search.get("utm_source")
    var utmMedium = search.get("utm_medium")
    var utmCampaign = search.get("utm_campaign")
    if (utmSource) payload.utm_source = utmSource
    if (utmMedium) payload.utm_medium = utmMedium
    if (utmCampaign) payload.utm_campaign = utmCampaign

    send(payload)
  }

  function trackEvent(name, props) {
    if (!name) return
    send({ site_id: siteId, name: String(name), props: props || undefined })
  }

  function trackOutboundLink(event) {
    var target = event.target
    var anchor = target && target.closest ? target.closest("a[href]") : null
    if (!anchor) return

    try {
      var url = new URL(anchor.href, location.href)
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname !== location.hostname
      ) {
        send({
          site_id: siteId,
          outbound_url: url.origin + url.pathname,
        })
      }
    } catch (_err) {}
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
  document.addEventListener("click", trackOutboundLink, true)

  // Public API for custom events (§6).
  window.wa = { track: trackEvent }

  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    trackPageview()
  } else {
    document.addEventListener("DOMContentLoaded", trackPageview)
  }
})()
