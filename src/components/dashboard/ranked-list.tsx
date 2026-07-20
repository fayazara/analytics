import { useEffect, useRef, useState, type ReactNode } from "react"

export interface RankedListItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  value: number
}

interface RankedListProps {
  items: RankedListItem[]
  valueFormat?: (value: number) => string
  emptyLabel?: string
  /**
   * Denominator for the hover-reveal "% of total" figure. Pass the true
   * site-wide total for this metric (e.g. `summary.visits`) — not the sum
   * of just the rows shown here — otherwise the percentages overstate
   * each row's share once the list is truncated to its top N.
   * Defaults to the sum of `items` when omitted.
   */
  total?: number
}

/** Fixed-height container so every panel in the grid lines up, regardless
 * of how many rows it has (§8 — "very minimal two column design"). */
const LIST_HEIGHT = "h-72"

/** A minimal ranked bar-list — label + proportional bar + value, per row.
 * Hovering anywhere over the list slides open each row's share of the
 * total (linear width reveal, no fade) next to its value — the value
 * itself shifts left as the reveal opens, it's not just unmasked. */
export function RankedList({
  items,
  valueFormat,
  emptyLabel = "No data yet",
  total,
}: RankedListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showFade, setShowFade] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = () => {
      setShowFade(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
    }
    update()

    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [items])

  if (items.length === 0) {
    return (
      <div className={`flex ${LIST_HEIGHT} items-center justify-center`}>
        <p className="text-sm text-kumo-subtle">{emptyLabel}</p>
      </div>
    )
  }

  const max = Math.max(1, ...items.map((i) => i.value))
  const denominator = total ?? items.reduce((sum, i) => sum + i.value, 0)

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className={`group flex ${LIST_HEIGHT} flex-col gap-0.5 overflow-y-auto pr-1`}
      >
        {items.map((item) => {
          const percent =
            denominator > 0 ? Math.round((item.value / denominator) * 100) : 0
          return (
            <div
              key={item.key}
              className="relative flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-kumo-subtle"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-md bg-kumo-tint"
                style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }}
              />
              <div className="relative flex min-w-0 flex-1 items-center gap-2">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </div>
              <div className="relative flex shrink-0 items-center">
                <span className="font-medium text-kumo-default">
                  {valueFormat
                    ? valueFormat(item.value)
                    : item.value.toLocaleString()}
                </span>
                <span className="grid grid-cols-[0fr] overflow-hidden transition-[grid-template-columns] duration-100 ease-linear group-hover:grid-cols-[1fr]">
                  <span className="overflow-hidden pl-1 text-xs whitespace-nowrap text-kumo-subtle">
                    · {percent}%
                  </span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-kumo-base to-transparent transition-opacity duration-200 ${
          showFade ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  )
}
