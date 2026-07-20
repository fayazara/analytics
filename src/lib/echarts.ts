/**
 * Central ECharts registration (§8 — kumo's `TimeseriesChart` is a thin
 * wrapper around ECharts; the consumer imports only the modules it needs
 * for bundle size). Import `echarts` from here everywhere instead of
 * `echarts/core` directly, so registration always runs first.
 */
import * as echarts from "echarts/core"
import { BarChart, LineChart } from "echarts/charts"
import {
  AriaComponent,
  AxisPointerComponent,
  BrushComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"

echarts.use([
  LineChart,
  BarChart,
  AriaComponent,
  AxisPointerComponent,
  BrushComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

export { echarts }
