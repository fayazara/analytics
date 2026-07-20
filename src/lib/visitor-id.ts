/**
 * Cookieless visitor identification (§4 of the spec).
 *
 * visitor_id = sha256(site_id + CF-Connecting-IP + User-Agent), truncated
 * to 16 bytes (32 hex chars). No date component — the same person gets the
 * same id across days so multi-day uniques are accurate, not summed
 * daily approximations.
 */
export async function computeVisitorId(
  siteId: string,
  ip: string,
  userAgent: string,
): Promise<string> {
  const input = `${siteId}:${ip}:${userAgent}`
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", data)
  const bytes = new Uint8Array(digest).slice(0, 16)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
