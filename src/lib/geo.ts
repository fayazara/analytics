/**
 * Reads geo data out of `request.cf` — Cloudflare's edge-provided geo
 * lookup, no third-party GeoIP service needed (§1, §3).
 */
export interface GeoInfo {
  country: string
  region: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
}

function parseCoordinate(
  value: string | undefined,
  min: number,
  max: number
): number | null {
  if (!value) return null
  const coordinate = Number(value)
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max
    ? coordinate
    : null
}

export function extractGeo(request: Request): GeoInfo {
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf
  return {
    country: cf?.country ?? "XX",
    region: cf?.regionCode ?? cf?.region ?? null,
    city: cf?.city ?? null,
    latitude: parseCoordinate(cf?.latitude, -90, 90),
    longitude: parseCoordinate(cf?.longitude, -180, 180),
  }
}

export function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "0.0.0.0"
}
