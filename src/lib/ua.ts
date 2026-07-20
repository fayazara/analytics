/**
 * Lightweight regex-based User-Agent parser.
 *
 * Deliberately not `ua-parser-js` (or similar) — those pull in a lot of
 * bundle weight for what's a handful of pattern checks at this scale
 * (§6 of the spec). Covers the common desktop/mobile browsers and OSes;
 * anything unmatched falls back to "Unknown"/"Other".
 */

export interface ParsedUserAgent {
  browser: string
  os: string
  deviceType: "desktop" | "mobile" | "tablet"
}

const BROWSER_PATTERNS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/Firefox\//, "Firefox"],
  [/CriOS/, "Chrome"],
  [/Chrome\//, "Chrome"],
  [/Version\/.*Safari\//, "Safari"],
  [/Safari\//, "Safari"],
  [/MSIE|Trident\//, "Internet Explorer"],
]

const OS_PATTERNS: [RegExp, string][] = [
  [/Windows NT/, "Windows"],
  [/Mac OS X/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Android/, "Android"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Linux/, "Linux"],
]

export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  const ua = userAgent ?? ""

  let browser = "Unknown"
  for (const [pattern, name] of BROWSER_PATTERNS) {
    if (pattern.test(ua)) {
      browser = name
      break
    }
  }

  let os = "Unknown"
  for (const [pattern, name] of OS_PATTERNS) {
    if (pattern.test(ua)) {
      os = name
      break
    }
  }

  let deviceType: ParsedUserAgent["deviceType"] = "desktop"
  if (/iPad|Tablet|Nexus (7|9|10)|SM-T/.test(ua)) {
    deviceType = "tablet"
  } else if (/Mobi|iPhone|iPod|Android.*Mobile/.test(ua)) {
    deviceType = "mobile"
  }

  return { browser, os, deviceType }
}
