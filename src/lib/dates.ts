/**
 * Date-range helpers, timezone-aware (per-site `timezone`, §5).
 *
 * D1/SQLite has no timezone-aware date functions, so all bucketing here
 * is done in JS with `Intl.DateTimeFormat`. Offsets are computed once per
 * call rather than looked up from a timezone database — good enough for
 * a personal-analytics tool; DST-transition edges may be off by a few
 * minutes, which doesn't matter at daily-rollup granularity.
 */

export type RangeKey = "today" | "7d" | "30d" | "6m" | "1y" | "custom"

export function isRangeKey(value: string | null): value is RangeKey {
  return (
    value === "today" ||
    value === "7d" ||
    value === "30d" ||
    value === "6m" ||
    value === "1y" ||
    value === "custom"
  )
}

/** Formats a Date as `YYYY-MM-DD` in the given IANA timezone. */
export function formatDateInTz(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}`
}

export function todayInTz(timezone: string): string {
  return formatDateInTz(new Date(), timezone)
}

/** Minutes to add to a UTC timestamp to get local wall-clock time. */
function getTimezoneOffsetMinutes(timezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return (asUtc - date.getTime()) / 60_000
}

/** UTC epoch ms for local midnight of `dateStr` (YYYY-MM-DD) in `timezone`. */
export function startOfDayUtcMs(dateStr: string, timezone: string): number {
  const guessUtcMs = Date.parse(`${dateStr}T00:00:00Z`)
  const offsetMin = getTimezoneOffsetMinutes(timezone, new Date(guessUtcMs))
  return guessUtcMs - offsetMin * 60_000
}

/** Inclusive list of `YYYY-MM-DD` date strings from `fromDate` to `toDate`. */
export function dateRangeList(fromDate: string, toDate: string): string[] {
  const out: string[] = []
  const d = new Date(`${fromDate}T00:00:00Z`)
  const end = new Date(`${toDate}T00:00:00Z`)
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export interface ResolvedRange {
  /** First day of the range, inclusive, `YYYY-MM-DD` in site tz. */
  fromDate: string
  /** Last day of the range, inclusive, `YYYY-MM-DD` in site tz. */
  toDate: string
  /** "Today" in the site's timezone. */
  today: string
}

const RANGE_DAYS: Record<Exclude<RangeKey, "custom" | "today">, number> = {
  "7d": 6,
  "30d": 29,
  "6m": 182,
  "1y": 364,
}

export function resolveRange(
  range: RangeKey,
  timezone: string,
  customFrom?: string | null,
  customTo?: string | null,
): ResolvedRange {
  const today = todayInTz(timezone)

  if (range === "custom") {
    if (customFrom && customTo) {
      return { fromDate: customFrom, toDate: customTo, today }
    }
    return { fromDate: today, toDate: today, today }
  }

  if (range === "today") {
    return { fromDate: today, toDate: today, today }
  }

  const days = RANGE_DAYS[range] ?? RANGE_DAYS["30d"]
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return { fromDate: d.toISOString().slice(0, 10), toDate: today, today }
}

/**
 * Splits a resolved range into "complete past days" (safe to read from
 * `daily_*` rollups) and whether "today" is included (must be read from
 * raw tables). This is the query rule from §8.
 */
export function splitRangeForQuery(range: ResolvedRange) {
  const allDates = dateRangeList(range.fromDate, range.toDate)
  const rollupDates = allDates.filter((d) => d < range.today)
  const includesToday = allDates.includes(range.today)
  return { includesToday, rollupDates }
}
