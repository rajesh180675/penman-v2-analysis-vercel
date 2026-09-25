/**
 * Chart library barrel — one import site for all visualization primitives.
 *
 * Two tiers:
 * - Micro (pure SVG/CSS, zero deps): Sparkline, SparkBars, RadialProgress,
 *   GaugeChart, BulletChart — safe inside tables, tiles, lists.
 * - Full (Recharts): StackedAreaChart, MultiLineChart, TreemapChart,
 *   DivergingBarChart, GroupedBarChart, HorizontalBarList, RangeBandChart,
 *   DonutChart, CagrOverlayChart + the 17 pre-existing report charts.
 *
 * All components consume the wb-* token classes / chartUtils palette so
 * dark mode and INR formatting are consistent by construction.
 */
export { Sparkline, trendTone, type SparkTone } from "./Sparkline";
export { SparkBars, type SparkBarTone } from "./SparkBars";
export { RadialProgress, radialToneForScore, type RadialTone } from "./RadialProgress";
export { GaugeChart, type GaugeZone } from "./GaugeChart";
export { BulletChart } from "./BulletChart";
export { ChartCard } from "./ChartCard";
export { StackedAreaChart, type StackedAreaSeries } from "./StackedAreaChart";
export { MultiLineChart, type LineSeriesDef } from "./MultiLineChart";
export { TreemapChart, type TreemapEntry } from "./TreemapChart";
export { DivergingBarChart, type DivergingEntry } from "./DivergingBarChart";
export { QuantileFanChart, type QuantileBand } from "./QuantileFanChart";
export { CorrelationMatrix } from "./CorrelationMatrix";
export { GroupedBarChart, type GroupedBarSeries } from "./GroupedBarChart";
export { HorizontalBarList, type HBarEntry, type HBarTone } from "./HorizontalBarList";
export { RangeBandChart, type RangePoint } from "./RangeBandChart";
export { DonutChart, type DonutEntry } from "./DonutChart";
export { CagrOverlayChart, type CagrPoint } from "./CagrOverlayChart";
export { CHART_COLORS, CHART_PALETTE, fmtINR, fmtCr, fmtPct, fmtINRFull, fmtCrFull, TOOLTIP_STYLE } from "./chartUtils";
