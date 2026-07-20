import { Badge } from "@cloudflare/kumo/components/badge"
import {
  ChartLegend,
  ChartPalette,
  TimeseriesChart,
} from "@cloudflare/kumo/components/chart"
import { Empty } from "@cloudflare/kumo/components/empty"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Select } from "@cloudflare/kumo/components/select"
import { Text } from "@cloudflare/kumo/components/text"
import { ChartLineIcon } from "@phosphor-icons/react"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { asc } from "drizzle-orm"
import { useEffect, useMemo, useState } from "react"
import { z } from "zod"
import { AddSiteDialog } from "@/components/dashboard/add-site-dialog"
import { CountryFlag, SourceIcon } from "@/components/dashboard/icons"
import { RankedList } from "@/components/dashboard/ranked-list"
import { db } from "@/db"
import { sites } from "@/db/schema"
import { useLiveVisitorCount } from "@/hooks/use-live-visitors"
import { echarts } from "@/lib/echarts"
import { formatCompactNumber, formatPercent } from "@/lib/format"

/** Server function — the dashboard's own UI reads the site list this way. */
const getSites = createServerFn().handler(async () => {
  return await db.select().from(sites).orderBy(asc(sites.name)).all()
})

type UiRangeKey = "today" | "7d" | "30d" | "6m" | "1y"

const RANGE_OPTIONS: { value: UiRangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "6m", label: "Last 6 months" },
  { value: "1y", label: "Last 12 months" },
]

const searchSchema = z.object({
  site: z.string().optional(),
  range: z.enum(["today", "7d", "30d", "6m", "1y"]).optional(),
})

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  loader: () => getSites(),
  component: App,
})

interface SummaryResponse {
  visitors: number
  visits: number
  pageviews: number
  bounceRate: number
  avgDurationSeconds: number
}

interface TimeseriesPoint {
  timestamp: number
  pageviews: number
  visitors: number
}

interface TopPageRow {
  path: string
  pageviews: number
  visitors: number
}

interface TopSourceRow {
  referrerDomain: string
  utmSource: string
  utmMedium: string
  visits: number
}

interface TopDeviceRow {
  deviceType: string
  browser: string
  visits: number
}

interface TopLocationRow {
  country: string
  city: string
  visits: number
}

interface TopEventRow {
  name: string
  count: number
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return (await res.json()) as T
}

function App() {
  const allSites = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()

  const selectedSiteId =
    search.site && allSites.some((s) => s.id === search.site)
      ? search.site
      : allSites[0]?.id
  const range = search.range ?? "30d"

  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [points, setPoints] = useState<TimeseriesPoint[]>([])
  const [pageRows, setPageRows] = useState<TopPageRow[]>([])
  const [sourceRows, setSourceRows] = useState<TopSourceRow[]>([])
  const [deviceRows, setDeviceRows] = useState<TopDeviceRow[]>([])
  const [locationRows, setLocationRows] = useState<TopLocationRow[]>([])
  const [eventRows, setEventRows] = useState<TopEventRow[]>([])
  const [loading, setLoading] = useState(false)

  const liveCount = useLiveVisitorCount(selectedSiteId)

  useEffect(() => {
    if (!selectedSiteId) return
    const controller = new AbortController()
    setLoading(true)

    const base = `/api/sites/${selectedSiteId}`
    Promise.all([
      fetchJson<SummaryResponse>(
        `${base}/summary?range=${range}`,
        controller.signal
      ),
      fetchJson<{ points: TimeseriesPoint[] }>(
        `${base}/timeseries?range=${range}`,
        controller.signal,
      ),
      fetchJson<{ rows: TopPageRow[] }>(
        `${base}/pages?range=${range}`,
        controller.signal
      ),
      fetchJson<{ rows: TopSourceRow[] }>(
        `${base}/sources?range=${range}`,
        controller.signal
      ),
      fetchJson<{ rows: TopDeviceRow[] }>(
        `${base}/devices?range=${range}`,
        controller.signal
      ),
      fetchJson<{ rows: TopLocationRow[] }>(
        `${base}/locations?range=${range}`,
        controller.signal
      ),
      fetchJson<{ rows: TopEventRow[] }>(
        `${base}/events?range=${range}`,
        controller.signal
      ),
    ])
      .then(
        ([
          summaryRes,
          tsRes,
          pagesRes,
          sourcesRes,
          devicesRes,
          locationsRes,
          eventsRes,
        ]) => {
          setSummary(summaryRes)
        setPoints(tsRes.points)
          setPageRows(pagesRes.rows)
          setSourceRows(sourcesRes.rows)
          setDeviceRows(devicesRes.rows)
          setLocationRows(locationsRes.rows)
          setEventRows(eventsRes.rows)
        }
      )
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError")
          console.error(err)
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [selectedSiteId, range])

  function selectSite(id: string) {
    navigate({ to: "/", search: (prev) => ({ ...prev, site: id }) })
  }
  function selectRange(value: UiRangeKey) {
    navigate({ to: "/", search: (prev) => ({ ...prev, range: value }) })
  }
  async function handleSiteCreated(id: string) {
    await router.invalidate()
    selectSite(id)
  }

  const chartData = useMemo(
    () => [
      {
        name: "Pageviews",
        data: points.map((p) => [p.timestamp, p.pageviews] as [number, number]),
        color: ChartPalette.categorical(0),
      },
      {
        name: "Visitors",
        data: points.map((p) => [p.timestamp, p.visitors] as [number, number]),
        color: ChartPalette.categorical(1),
      },
    ],
    [points]
  )

  if (allSites.length === 0) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Empty
          icon={<ChartLineIcon size={40} />}
          title="No sites yet"
          description="Add your first site to start tracking pageviews, sources, and events."
          contents={<AddSiteDialog onCreated={handleSiteCreated} />}
        />
      </div>
    )
  }

  const selectedSite =
    allSites.find((s) => s.id === selectedSiteId) ?? allSites[0]!

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <SourceIcon domain={selectedSite.domain} />
          <Text variant="heading3" as="span" truncate>
            {selectedSite.name}
          </Text>
          {liveCount !== null && liveCount > 0 ? (
            <Badge variant="success" appearance="dot">
              {liveCount} online
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            value={selectedSiteId}
            onValueChange={(v) => v && selectSite(v)}
            renderValue={() => selectedSite.name}
            aria-label="Site"
          >
            {allSites.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                {s.name}
              </Select.Option>
            ))}
          </Select>
          <Select
            size="sm"
            value={range}
            onValueChange={(v) => v && selectRange(v as UiRangeKey)}
            renderValue={(v) =>
              RANGE_OPTIONS.find((o) => o.value === v)?.label ?? v
            }
            aria-label="Date range"
          >
            {RANGE_OPTIONS.map((o) => (
              <Select.Option key={o.value} value={o.value}>
                {o.label}
              </Select.Option>
            ))}
          </Select>
          <AddSiteDialog onCreated={handleSiteCreated} />
        </div>
      </header>

      <LayerCard>
        <LayerCard.Secondary>Overview</LayerCard.Secondary>
        <LayerCard.Primary>
          <div className="mb-3 flex flex-wrap divide-x divide-kumo-line px-1">
            <ChartLegend.LargeItem
              name="Visitors"
              color={ChartPalette.categorical(1)}
              value={formatCompactNumber(summary?.visitors ?? 0)}
              className="pr-4"
            />
            <ChartLegend.LargeItem
              name="Visits"
              color={ChartPalette.categorical(2)}
              value={formatCompactNumber(summary?.visits ?? 0)}
              className="px-4"
            />
            <ChartLegend.LargeItem
              name="Pageviews"
              color={ChartPalette.categorical(0)}
              value={formatCompactNumber(summary?.pageviews ?? 0)}
              className="px-4"
            />
            <ChartLegend.LargeItem
              name="Bounce rate"
              color={ChartPalette.semantic("Warning")}
              value={formatPercent(summary?.bounceRate ?? 0)}
              className="px-4"
            />
            {/* <ChartLegend.LargeItem
              name="Avg. duration"
              color={ChartPalette.semantic("Neutral")}
              value={formatDuration(summary?.avgDurationSeconds ?? 0)}
              className="pl-4"
            /> */}
          </div>
          <TimeseriesChart
            echarts={echarts}
            data={chartData}
            height={260}
            loading={loading && points.length === 0}
          />
        </LayerCard.Primary>
      </LayerCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LayerCard>
          <LayerCard.Secondary>Top pages</LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={pageRows.map((r) => ({
                key: r.path,
                label: r.path,
                value: r.pageviews,
              }))}
            />
          </LayerCard.Primary>
        </LayerCard>

        <LayerCard>
          <LayerCard.Secondary>Top sources</LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={sourceRows.map((r) => ({
                key: `${r.referrerDomain}-${r.utmSource}-${r.utmMedium}`,
                label: r.utmSource || r.referrerDomain,
                icon: <SourceIcon domain={r.referrerDomain} />,
                value: r.visits,
              }))}
            />
          </LayerCard.Primary>
        </LayerCard>

        <LayerCard>
          <LayerCard.Secondary>Devices</LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={deviceRows.map((r) => ({
                key: `${r.deviceType}-${r.browser}`,
                label: `${r.browser} · ${r.deviceType}`,
                value: r.visits,
              }))}
            />
          </LayerCard.Primary>
        </LayerCard>

        <LayerCard>
          <LayerCard.Secondary>Locations</LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={locationRows.map((r) => ({
                key: `${r.country}-${r.city}`,
                label: r.city || r.country,
                icon: <CountryFlag country={r.country} />,
                value: r.visits,
              }))}
            />
          </LayerCard.Primary>
        </LayerCard>

        <LayerCard className="sm:col-span-2">
          <LayerCard.Secondary>Custom events</LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={eventRows.map((r) => ({
                key: r.name,
                label: r.name,
                value: r.count,
              }))}
              emptyLabel="No custom events yet"
            />
          </LayerCard.Primary>
        </LayerCard>
      </div>
    </div>
  )
}
