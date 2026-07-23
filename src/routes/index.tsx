import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import {
  ChartLegend,
  ChartPalette,
  TimeseriesChart,
} from "@cloudflare/kumo/components/chart"
import { Empty } from "@cloudflare/kumo/components/empty"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import {
  AndroidLogoIcon,
  AppleLogoIcon,
  BrowserIcon,
  CaretDownIcon,
  CodeIcon,
  DesktopIcon,
  DeviceMobileIcon,
  DeviceTabletIcon,
  LinuxLogoIcon,
  TrashIcon,
  WindowsLogoIcon,
} from "@phosphor-icons/react"
import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import type {
  DeviceDimension,
  LocationDimension,
  PageDimension,
  SourceDimension,
  TopDeviceRow,
  TopEventRow,
  TopLocationRow,
  TopPageRow,
  TopSourceRow,
} from "@/lib/top-lists"
import { AddSiteDialog } from "@/components/dashboard/add-site-dialog"
import { DeleteSiteDialog } from "@/components/dashboard/delete-site-dialog"
import {
  ChromeLogo,
  CountryFlag,
  FirefoxLogo,
  MicrosoftEdgeLogo,
  SafariLogo,
  SamsungBrowserLogo,
  SourceIcon,
} from "@/components/dashboard/icons"
import { InstallScriptDialog } from "@/components/dashboard/install-script-dialog"
import { RankedList } from "@/components/dashboard/ranked-list"
import { useLiveVisitorCount } from "@/hooks/use-live-visitors"
import { echarts } from "@/lib/echarts"
import {
  formatCompactNumber,
  formatDuration,
  formatPercent,
} from "@/lib/format"

/** Server function — the dashboard's own UI reads its initial data this way. */
const getDashboardData = createServerFn().handler(async () => {
  const { loadDashboardData } = await import("@/lib/dashboard-data")
  return await loadDashboardData()
})

type UiRangeKey = "today" | "7d" | "30d" | "6m" | "1y"

const RANGE_OPTIONS: Array<{ value: UiRangeKey; label: string }> = [
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
  loader: () => getDashboardData(),
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

function BrowserMark({ browser }: { browser: string }) {
  let logo
  switch (browser) {
    case "Chrome":
      logo = <ChromeLogo />
      break
    case "Safari":
      logo = <SafariLogo />
      break
    case "Firefox":
      logo = <FirefoxLogo />
      break
    case "Edge":
    case "Microsoft Edge":
      logo = <MicrosoftEdgeLogo />
      break
    case "Samsung Internet":
    case "Samsung Browser":
      logo = <SamsungBrowserLogo />
      break
    default:
      logo = <BrowserIcon />
  }

  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center [&>svg]:size-5"
    >
      {logo}
    </span>
  )
}

function OsMark({ os }: { os: string }) {
  const className = "size-5 shrink-0 text-kumo-subtle"
  switch (os) {
    case "Windows":
      return <WindowsLogoIcon className={className} weight="fill" />
    case "macOS":
    case "iOS":
      return <AppleLogoIcon className={className} weight="fill" />
    case "Android":
      return <AndroidLogoIcon className={className} weight="fill" />
    case "Linux":
      return <LinuxLogoIcon className={className} weight="fill" />
    default:
      return <DesktopIcon className={className} />
  }
}

function DeviceMark({ device }: { device: string }) {
  const className = "size-5 shrink-0 text-kumo-subtle"
  if (device === "mobile") return <DeviceMobileIcon className={className} />
  if (device === "tablet") return <DeviceTabletIcon className={className} />
  return <DesktopIcon className={className} />
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return await res.json()
}

interface TopListResponse<TRow> {
  rows: Array<TRow>
  total: number
  animateItems: boolean
}

function useTopList<TRow>(
  siteId: string | undefined,
  range: UiRangeKey,
  resource: "pages" | "sources" | "devices" | "locations",
  view: string,
  animateViewChange: boolean
): TopListResponse<TRow> {
  const [result, setResult] = useState<TopListResponse<TRow>>({
    rows: [],
    total: 0,
    animateItems: false,
  })
  const resolvedViewRef = useRef<string | null>(null)

  useEffect(() => {
    if (!siteId) return
    const controller = new AbortController()
    setResult((current) => ({
      ...current,
      rows: [],
      total: 0,
      animateItems: false,
    }))

    fetchJson<Omit<TopListResponse<TRow>, "animateItems">>(
      `/api/sites/${siteId}/${resource}?range=${range}&view=${view}`,
      controller.signal
    )
      .then((nextResult) => {
        const shouldAnimate =
          animateViewChange &&
          resolvedViewRef.current !== null &&
          resolvedViewRef.current !== view
        resolvedViewRef.current = view
        setResult({
          ...nextResult,
          animateItems: shouldAnimate,
        })
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error(error)
        }
      })

    return () => controller.abort()
  }, [siteId, range, resource, view, animateViewChange])

  return result
}

function CardHeader({
  title,
  tabs,
  value,
  onValueChange,
}: {
  title: string
  tabs: Array<{ value: string; label: string }>
  value: string
  onValueChange: (value: string, animate: boolean) => void
}) {
  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="shrink-0">{title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {tabs.map((tab) => {
          const selected = tab.value === value
          return (
            <Button
              key={tab.value}
              type="button"
              variant="ghost"
              size="xs"
              aria-pressed={selected}
              className={
                selected
                  ? "bg-kumo-fill text-kumo-default hover:bg-kumo-fill"
                  : "text-kumo-subtle opacity-50 hover:opacity-100"
              }
              onClick={(event) =>
                onValueChange(tab.value, event.detail !== 0)
              }
            >
              {tab.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" })

function locationLabel(row: TopLocationRow, dimension: LocationDimension) {
  const country = countryNames.of(row.country) ?? row.country
  if (dimension === "city") return `${row.city}, ${country}`
  if (dimension === "region") return `${row.region}, ${country}`
  return country
}

function App() {
  const { sites: allSites, trackerOrigin } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()

  const selectedSiteId =
    search.site && allSites.some((s) => s.id === search.site)
      ? search.site
      : allSites[0]?.id
  const range = search.range ?? "30d"

  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [points, setPoints] = useState<Array<TimeseriesPoint>>([])
  const [eventRows, setEventRows] = useState<Array<TopEventRow>>([])
  const [pageDimension, setPageDimension] = useState<PageDimension>("top")
  const [sourceDimension, setSourceDimension] =
    useState<SourceDimension>("referrer")
  const [deviceDimension, setDeviceDimension] =
    useState<DeviceDimension>("browser")
  const [locationDimension, setLocationDimension] =
    useState<LocationDimension>("country")
  const [loading, setLoading] = useState(false)
  const [addSiteOpen, setAddSiteOpen] = useState(false)
  const [deleteSiteId, setDeleteSiteId] = useState<string | null>(null)
  const [installSiteId, setInstallSiteId] = useState<string | null>(null)
  const animatePageFilterRef = useRef(false)
  const animateSourceFilterRef = useRef(false)
  const animateDeviceFilterRef = useRef(false)
  const animateLocationFilterRef = useRef(false)

  const liveCount = useLiveVisitorCount(selectedSiteId)
  const pageList = useTopList<TopPageRow>(
    selectedSiteId,
    range,
    "pages",
    pageDimension,
    animatePageFilterRef.current
  )
  const sourceList = useTopList<TopSourceRow>(
    selectedSiteId,
    range,
    "sources",
    sourceDimension,
    animateSourceFilterRef.current
  )
  const deviceList = useTopList<TopDeviceRow>(
    selectedSiteId,
    range,
    "devices",
    deviceDimension,
    animateDeviceFilterRef.current
  )
  const locationList = useTopList<TopLocationRow>(
    selectedSiteId,
    range,
    "locations",
    locationDimension,
    animateLocationFilterRef.current
  )

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
      fetchJson<{ points: Array<TimeseriesPoint> }>(
        `${base}/timeseries?range=${range}`,
        controller.signal
      ),
      fetchJson<{ rows: Array<TopEventRow> }>(
        `${base}/activity?range=${range}`,
        controller.signal
      ),
    ])
      .then(([summaryRes, tsRes, eventsRes]) => {
        setSummary(summaryRes)
        setPoints(tsRes.points)
        setEventRows(eventsRes.rows)
      })
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
    setInstallSiteId(id)
  }

  async function handleSiteDeleted(id: string) {
    const nextSite = allSites.find((site) => site.id !== id)
    setDeleteSiteId(null)
    await router.invalidate()
    navigate({
      to: "/",
      search: (prev) => ({ ...prev, site: nextSite?.id }),
      replace: true,
    })
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
          icon={<ChartBarIcon weight="duotone" size={32} />}
          title="Add a site to start tracking"
          contents={<AddSiteDialog onCreated={handleSiteCreated} />}
          className="max-w-sm [h2]:text-sm"
        />
      </div>
    )
  }

  const selectedSite =
    allSites.find((s) => s.id === selectedSiteId) ?? allSites[0]
  const installSite =
    allSites.find((site) => site.id === installSiteId) ?? selectedSite
  const deleteSite =
    allSites.find((site) => site.id === deleteSiteId) ?? selectedSite
  const rangeLabel =
    RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <Button
                  variant="ghost"
                  className="-ml-2 max-w-full min-w-0 justify-start px-2"
                  aria-label={`Switch site. Current site: ${selectedSite.name}`}
                >
                  <SourceIcon domain={selectedSite.domain} />
                  <p className="max-w-52 shrink-0 font-semibold">
                    {selectedSite.name}
                  </p>
                  <CaretDownIcon
                    className="size-4 shrink-0 text-neutral-500"
                    weight="bold"
                  />
                </Button>
              }
            />
            <DropdownMenu.Content align="start" className="t-dropdown min-w-56">
              {allSites.map((site) => (
                <DropdownMenu.Item
                  key={site.id}
                  icon={<SourceIcon domain={site.domain} />}
                  selected={site.id === selectedSiteId}
                  className="gap-2 [&>span:last-child]:ml-auto"
                  onClick={() => selectSite(site.id)}
                >
                  {site.name}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator />
              <DropdownMenu.Item onClick={() => setAddSiteOpen(true)}>
                Add site
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                variant="danger"
                icon={<TrashIcon />}
                onClick={() => setDeleteSiteId(selectedSite.id)}
              >
                Delete site
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
          {liveCount !== null && liveCount > 0 ? (
            <Badge variant="success" appearance="dot">
              {liveCount} online
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            icon={<CodeIcon weight="bold" className="text-neutral-800" />}
            onClick={() => setInstallSiteId(selectedSite.id)}
            aria-label="Install script"
          />
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <Button variant="ghost" aria-label="Select date range">
                  {rangeLabel}
                  <CaretDownIcon
                    className="size-4 text-neutral-500"
                    weight="bold"
                  />
                </Button>
              }
            />
            <DropdownMenu.Content
              align="end"
              className="t-dropdown t-dropdown-origin-top-right min-w-44"
            >
              {RANGE_OPTIONS.map((option) => (
                <DropdownMenu.Item
                  key={option.value}
                  selected={option.value === range}
                  className="[&>span:last-child]:ml-auto"
                  onClick={() => selectRange(option.value)}
                >
                  {option.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>
      </header>

      <AddSiteDialog
        open={addSiteOpen}
        onOpenChange={setAddSiteOpen}
        showTrigger={false}
        onCreated={handleSiteCreated}
      />
      <InstallScriptDialog
        open={installSiteId !== null}
        onOpenChange={(open) => !open && setInstallSiteId(null)}
        siteId={installSite.id}
        siteName={installSite.name}
        trackerOrigin={trackerOrigin}
      />
      <DeleteSiteDialog
        open={deleteSiteId !== null}
        onOpenChange={(open) => !open && setDeleteSiteId(null)}
        siteId={deleteSite.id}
        siteName={deleteSite.name}
        onDeleted={handleSiteDeleted}
      />

      <LayerCard>
        <LayerCard.Secondary>Overview</LayerCard.Secondary>
        <LayerCard.Primary className="h-full p-2.5">
          <div className="mb-3 flex flex-wrap divide-x divide-neutral-100 px-1">
            <ChartLegend.LargeItem
              name="Visitors"
              color={ChartPalette.categorical(1)}
              value={formatCompactNumber(summary?.visitors ?? 0)}
              className="min-w-32 pr-4"
            />
            <ChartLegend.LargeItem
              name="Visits"
              color={ChartPalette.categorical(2)}
              value={formatCompactNumber(summary?.visits ?? 0)}
              className="min-w-32 px-4"
            />
            <ChartLegend.LargeItem
              name="Pageviews"
              color={ChartPalette.categorical(0)}
              value={formatCompactNumber(summary?.pageviews ?? 0)}
              className="min-w-32 px-4"
            />
            <ChartLegend.LargeItem
              name="Bounce rate"
              color={ChartPalette.semantic("Warning")}
              value={formatPercent(summary?.bounceRate ?? 0)}
              className="min-w-32 px-4"
            />
            <ChartLegend.LargeItem
              name="Avg. duration"
              color={ChartPalette.semantic("Neutral")}
              value={formatDuration(summary?.avgDurationSeconds ?? 0)}
              className="min-w-32 pl-4"
            />
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
          <LayerCard.Secondary>
            <CardHeader
              title="Pages"
              tabs={[
                { value: "top", label: "Top" },
                { value: "entered", label: "Entered" },
                { value: "exited", label: "Exited" },
              ]}
              value={pageDimension}
              onValueChange={(value, animate) => {
                animatePageFilterRef.current = animate
                setPageDimension(value as PageDimension)
              }}
            />
          </LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={pageList.rows.map((r) => ({
                key: r.path,
                label: r.path,
                value: r.count,
              }))}
              total={pageList.total}
              animateItems={pageList.animateItems}
            />
          </LayerCard.Primary>
        </LayerCard>

        <LayerCard>
          <LayerCard.Secondary>
            <CardHeader
              title="Sources"
              tabs={[
                { value: "referrer", label: "Referrers" },
                { value: "links", label: "Links" },
                { value: "utm", label: "UTM" },
              ]}
              value={sourceDimension}
              onValueChange={(value, animate) => {
                animateSourceFilterRef.current = animate
                setSourceDimension(value as SourceDimension)
              }}
            />
          </LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={sourceList.rows.map((r) => ({
                key: r.key,
                label: r.label,
                icon: r.referrerDomain ? (
                  <SourceIcon domain={r.referrerDomain} />
                ) : undefined,
                value: r.visits,
              }))}
              total={sourceList.total}
              animateItems={sourceList.animateItems}
              emptyLabel={
                sourceDimension === "links"
                  ? "No outbound link clicks yet"
                  : sourceDimension === "utm"
                    ? "No UTM traffic yet"
                    : "No referrers yet"
              }
            />
          </LayerCard.Primary>
        </LayerCard>

        <LayerCard>
          <LayerCard.Secondary>
            <CardHeader
              title="Devices"
              tabs={[
                { value: "browser", label: "Browsers" },
                { value: "os", label: "OS" },
                { value: "device", label: "Devices" },
              ]}
              value={deviceDimension}
              onValueChange={(value, animate) => {
                animateDeviceFilterRef.current = animate
                setDeviceDimension(value as DeviceDimension)
              }}
            />
          </LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={deviceList.rows.map((r) => ({
                key: r.value,
                label:
                  deviceDimension === "device"
                    ? `${r.value.charAt(0).toUpperCase()}${r.value.slice(1)}`
                    : r.value,
                icon:
                  deviceDimension === "browser" ? (
                    <BrowserMark browser={r.value} />
                  ) : deviceDimension === "os" ? (
                    <OsMark os={r.value} />
                  ) : (
                    <DeviceMark device={r.value} />
                  ),
                value: r.visits,
              }))}
              total={deviceList.total}
              animateItems={deviceList.animateItems}
            />
          </LayerCard.Primary>
        </LayerCard>

        <LayerCard>
          <LayerCard.Secondary>
            <CardHeader
              title="Locations"
              tabs={[
                { value: "country", label: "Countries" },
                { value: "region", label: "Regions" },
                { value: "city", label: "Cities" },
              ]}
              value={locationDimension}
              onValueChange={(value, animate) => {
                animateLocationFilterRef.current = animate
                setLocationDimension(value as LocationDimension)
              }}
            />
          </LayerCard.Secondary>
          <LayerCard.Primary className="h-full p-2.5">
            <RankedList
              items={locationList.rows.map((r) => ({
                key: `${r.country}-${r.region}-${r.city}`,
                label: locationLabel(r, locationDimension),
                icon: <CountryFlag country={r.country} />,
                value: r.visits,
              }))}
              total={locationList.total}
              animateItems={locationList.animateItems}
              emptyLabel={
                locationDimension === "region"
                  ? "No region data yet"
                  : locationDimension === "city"
                    ? "No city data yet"
                    : "No country data yet"
              }
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
