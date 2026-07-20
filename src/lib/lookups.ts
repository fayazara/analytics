import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { devices, locations, sources } from "@/db/schema"
import type { GeoInfo } from "@/lib/geo"
import type { ParsedUserAgent } from "@/lib/ua"

export interface ParsedReferrer {
  referrerDomain: string
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
}

/** Extracts referrer domain + UTM params for the `sources` lookup table. */
export function parseReferrer(
  referrer: string | null,
  siteHostname: string,
): ParsedReferrer {
  let referrerDomain = "(direct)"
  let utmSource: string | null = null
  let utmMedium: string | null = null
  let utmCampaign: string | null = null

  if (referrer) {
    try {
      const refUrl = new URL(referrer)
      utmSource = refUrl.searchParams.get("utm_source")
      utmMedium = refUrl.searchParams.get("utm_medium")
      utmCampaign = refUrl.searchParams.get("utm_campaign")
      if (refUrl.hostname && refUrl.hostname !== siteHostname) {
        referrerDomain = refUrl.hostname.replace(/^www\./, "")
      }
    } catch {
      // malformed referrer — treat as direct
    }
  }

  return { referrerDomain, utmSource, utmMedium, utmCampaign }
}

/**
 * Resolves (or inserts) a `sources` row and returns its id.
 *
 * SQLite unique indexes treat `NULL` as distinct from every other `NULL`,
 * so nullable columns are normalized to `""` here — otherwise every
 * direct/no-UTM pageview would insert a fresh row instead of deduping
 * against the existing one (§6).
 */
export async function resolveSourceId(
  siteId: string,
  referrer: ParsedReferrer,
): Promise<number> {
  const utmSource = referrer.utmSource ?? ""
  const utmMedium = referrer.utmMedium ?? ""
  const utmCampaign = referrer.utmCampaign ?? ""

  await db
    .insert(sources)
    .values({
      siteId,
      referrerDomain: referrer.referrerDomain,
      utmSource,
      utmMedium,
      utmCampaign,
    })
    .onConflictDoNothing()

  const [row] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.siteId, siteId),
        eq(sources.referrerDomain, referrer.referrerDomain),
        eq(sources.utmSource, utmSource),
        eq(sources.utmMedium, utmMedium),
        eq(sources.utmCampaign, utmCampaign),
      ),
    )
    .limit(1)

  return row!.id
}

export async function resolveDeviceId(
  parsed: ParsedUserAgent,
): Promise<number> {
  await db
    .insert(devices)
    .values({
      browser: parsed.browser,
      os: parsed.os,
      deviceType: parsed.deviceType,
    })
    .onConflictDoNothing()

  const [row] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.browser, parsed.browser),
        eq(devices.os, parsed.os),
        eq(devices.deviceType, parsed.deviceType),
      ),
    )
    .limit(1)

  return row!.id
}

export async function resolveLocationId(geo: GeoInfo): Promise<number> {
  const region = geo.region ?? ""
  const city = geo.city ?? ""

  await db
    .insert(locations)
    .values({ country: geo.country, region, city })
    .onConflictDoNothing()

  const [row] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.country, geo.country),
        eq(locations.region, region),
        eq(locations.city, city),
      ),
    )
    .limit(1)

  return row!.id
}
