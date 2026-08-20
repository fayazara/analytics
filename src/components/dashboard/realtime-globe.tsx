import { useEffect, useMemo, useRef } from "react"
import type { Globe, Marker } from "cobe"
import type { CSSProperties } from "react"
import type { RealtimeVisitorLocation } from "@/lib/realtime"

interface RealtimeGlobeProps {
  count: number
  locations: Array<RealtimeVisitorLocation>
  simulate?: boolean
}

const SIMULATED_LOCATIONS: Array<RealtimeVisitorLocation> = [
  { latitude: 37.7749, longitude: -122.4194, count: 3 },
  { latitude: 40.7128, longitude: -74.006, count: 2 },
  { latitude: 51.5072, longitude: -0.1276, count: 2 },
  { latitude: 12.9716, longitude: 77.5946, count: 4 },
  { latitude: 1.3521, longitude: 103.8198, count: 1 },
  { latitude: 35.6762, longitude: 139.6503, count: 2 },
  { latitude: -33.8688, longitude: 151.2093, count: 1 },
  { latitude: -23.5505, longitude: -46.6333, count: 2 },
  { latitude: -33.9249, longitude: 18.4241, count: 1 },
]

const AVATAR_SEEDS = [
  "Felix",
  "Aneka",
  "Milo",
  "Luna",
  "Jasper",
  "Zoe",
  "Arlo",
  "Cleo",
  "Finn",
  "Nala",
  "Remy",
  "Sage",
]

interface AvatarMarker {
  id: string
  location: [number, number]
  seed: string
}

function hashLocation(latitude: number, longitude: number): number {
  const value = `${latitude}:${longitude}`
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

export function RealtimeGlobe({
  count,
  locations,
  simulate = false,
}: RealtimeGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<Globe | null>(null)
  const rotationRef = useRef(0)
  const pointerXRef = useRef<number | null>(null)

  const displayedLocations = simulate ? SIMULATED_LOCATIONS : locations
  const displayedCount = simulate
    ? SIMULATED_LOCATIONS.reduce((total, location) => total + location.count, 0)
    : count

  const avatarMarkers = useMemo<Array<AvatarMarker>>(
    () =>
      displayedLocations.map((location) => {
        const hash = hashLocation(location.latitude, location.longitude)
        return {
          id: `visitor-${hash}`,
          location: [location.latitude, location.longitude],
          seed: AVATAR_SEEDS[hash % AVATAR_SEEDS.length] ?? "Felix",
        }
      }),
    [displayedLocations]
  )

  const markers = useMemo<Array<Marker>>(
    () =>
      avatarMarkers.map((marker) => ({
        id: marker.id,
        location: marker.location,
        size: 0,
      })),
    [avatarMarkers]
  )
  const markersRef = useRef(markers)
  markersRef.current = markers

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let cancelled = false
    let animationFrame = 0
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    function resize() {
      if (!globeRef.current) return
      const currentContainer = containerRef.current
      if (!currentContainer) return
      const bounds = currentContainer.getBoundingClientRect()
      globeRef.current.update({
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
      })
    }

    void import("cobe").then(({ default: createGlobe }) => {
      if (cancelled) return
      const bounds = container.getBoundingClientRect()
      globeRef.current = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio, 2),
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
        phi: rotationRef.current,
        theta: 0.16,
        dark: 0,
        diffuse: 1.2,
        scale: 0.95,
        mapSamples: 12000,
        mapBrightness: 5,
        mapBaseBrightness: 0,
        baseColor: [1, 1, 1],
        markerColor: [0.96, 0.45, 0.12],
        glowColor: [0.96, 0.97, 0.98],
        markerElevation: 0.03,
        markers: markersRef.current,
      })

      const render = () => {
        if (!globeRef.current) return
        if (!reduceMotion && pointerXRef.current === null) {
          rotationRef.current += 0.0015
        }
        globeRef.current.update({ phi: rotationRef.current })
        animationFrame = requestAnimationFrame(render)
      }
      animationFrame = requestAnimationFrame(render)
      resize()
    })

    const observer = new ResizeObserver(resize)
    observer.observe(container)

    return () => {
      cancelled = true
      observer.disconnect()
      cancelAnimationFrame(animationFrame)
      globeRef.current?.destroy()
      globeRef.current = null
    }
  }, [])

  useEffect(() => {
    globeRef.current?.update({ markers })
  }, [markers])

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-72 w-full overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Realtime visitor globe with ${displayedLocations.length} active locations`}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pointerXRef.current = event.clientX
        }}
        onPointerMove={(event) => {
          if (pointerXRef.current === null) return
          rotationRef.current += (event.clientX - pointerXRef.current) / 180
          pointerXRef.current = event.clientX
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId)
          pointerXRef.current = null
        }}
        onPointerCancel={() => {
          pointerXRef.current = null
        }}
      />
      {avatarMarkers.map((marker) => {
        const visibility = `var(--cobe-visible-${marker.id}, 0)`
        return (
          <img
            key={marker.id}
            src={`https://api.dicebear.com/10.x/adventurer/svg?seed=${encodeURIComponent(marker.seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute z-10 size-6 rounded-full bg-white object-cover shadow-md ring-2 ring-white transition-[opacity,filter] duration-200"
            style={
              {
                positionAnchor: `--cobe-${marker.id}`,
                left: "anchor(center)",
                top: "anchor(center)",
                translate: "-50% -50%",
                opacity: visibility,
                filter: `blur(calc((1 - ${visibility}) * 4px))`,
              } as CSSProperties & { positionAnchor: string }
            }
          />
        )
      })}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-kumo-subtle">
        {displayedCount > 0
          ? `${displayedCount} ${displayedCount === 1 ? "visitor" : "visitors"} online`
          : "No visitors online"}
      </div>
    </div>
  )
}
