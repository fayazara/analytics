import { GlobeIcon } from "@phosphor-icons/react"

/** Referrer domain favicon via Google's favicon cache. */
export function SourceIcon({ domain }: { domain: string }) {
  if (!domain || domain === "(direct)") {
    return <GlobeIcon size={20} className="size-5 shrink-0 text-kumo-subtle" />
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`}
      alt=""
      className="size-5 shrink-0 rounded-sm"
      loading="lazy"
    />
  )
}

/** Country flag via iconify's circle-flags set. */
export function CountryFlag({ country }: { country: string }) {
  if (!country || country === "XX") {
    return <GlobeIcon size={20} className="size-5 shrink-0 text-kumo-subtle" />
  }
  return (
    <img
      src={`https://api.iconify.design/circle-flags:${country.toLowerCase()}.svg`}
      alt=""
      className="size-5 shrink-0 rounded-full"
      loading="lazy"
    />
  )
}
