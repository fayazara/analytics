/**
 * Reads geo data out of `request.cf` — Cloudflare's edge-provided geo
 * lookup, no third-party GeoIP service needed (§1, §3).
 */
export interface GeoInfo {
  country: string
  region: string | null
  city: string | null
}

export function extractGeo(request: Request): GeoInfo {
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf
  return {
    country: cf?.country ?? "XX",
    region: (cf?.regionCode as string | undefined) ?? cf?.region ?? null,
    city: cf?.city ?? null,
  }
}

export function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "0.0.0.0"
}
