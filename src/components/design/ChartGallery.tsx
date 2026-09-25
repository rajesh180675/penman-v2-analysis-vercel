/**
 * ChartGallery — greenfield visualization showcase.
 * One-stop visual regression + discovery surface for every chart primitive.
 * Dev-and-demo surface: mock data shaped like real engine outputs.
 * Toggle dark mode to verify token-based theming across all charts.
 */
import { Panel } from "../shared/Panel";
import { SectionHeader } from "../shared/DesignSystem";
import { Metric } from "../shared/Metric";
import {
  Sparkline,
  SparkBars,
  RadialProgress,
  radialToneForScore,
  GaugeChart,
  BulletChart,
  ChartCard,
  StackedAreaChart,
  MultiLineChart,
  TreemapChart,
  DivergingBarChart,
  QuantileFanChart,
  CorrelationMatrix,
  GroupedBarChart,
  HorizontalBarList,
  RangeBandChart,
  DonutChart,
  CagrOverlayChart,
  fmtPct,
} from "../charts";

// ─── Mock data shaped like real engine outputs ──────────────────────────────

const PERIODS = ["FY19", "FY20", "FY21", "FY22", "FY23", "FY24", "FY25"];

const ROCE_TREND = [0.142, 0.155, 0.121, 0.168, 0.184, 0.191, 0.187];
const FCF_TREND = [4120, 3850, 5210, 6480, 5920, 7450, 8120];
const QUARTERLY_DELTAS = [2.1, -0.8, 3.4, 1.2, -1.5, 0.6, 2.8, -0.3];

const MARGIN_LINES: Record<string, string | number | null>[] = PERIODS.map((p, i) => ({
  period: p,
  gross: [42.1, 43.0, 40.2, 44.8, 46.1, 45.5, 46.8][i] ?? null,
  ebitda: [24.5, 25.8, 22.1, 27.4, 28.9, 28.1, 29.4][i] ?? null,
  pat: [14.2, 15.1, 12.4, 16.8, 18.2, 17.5, 18.6][i] ?? null,
}));

const REVENUE_MIX: Record<string, string | number | null>[] = PERIODS.map((p, i) => ({
  period: p,
  staples: [5200, 5450, 5780, 6100, 6420, 6780, 7150][i] ?? null,
  discretionary: [2800, 2650, 3100, 3560, 3980, 4350, 4720][i] ?? null,
  exports: [1400, 1520, 1680, 1890, 2140, 2380, 2650][i] ?? null,
  other: [420, 450, 480, 520, 560, 610, 660][i] ?? null,
}));

const SEGMENTS = [
  { name: "FMCG Home Care", size: 7150, display: "+9.2%" },
  { name: "Personal Care", size: 4720, display: "+12.4%" },
  { name: "Foods", size: 2650, display: "+7.1%" },
  { name: "Agri Business", size: 1820, display: "+4.3%" },
  { name: "Paperboards", size: 1140, display: "-2.1%" },
  { name: "Hotels", size: 660, display: "+18.9%" },
];

const ACCRUAL_VS_CASH = PERIODS.map((p, i) => ({
  label: p,
  value: [1250, -840, 420, -1610, 980, -230, 670][i]!,
}));

const SCORES = [
  { label: "Earnings Quality", score: 0.84 },
  { label: "Balance Sheet", score: 0.72 },
  { label: "Cash Conversion", score: 0.91 },
  { label: "Governance", score: 0.66 },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChartGallery() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Chart Gallery"
        subtitle="Greenfield visualization library — every primitive with token-based theming. Toggle dark mode to verify."
        icon="chart"
      />

      {/* ── Micro charts ─────────────────────────────────────────────── */}
      <Panel title="Micro charts" subtitle="Pure SVG/CSS — zero Recharts overhead. Safe in tables, tiles, lists.">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Metric
            label="ROCE (7Y)"
            value={0.187}
            format="pct"
            trend={0.004}
            context={
              <span className="inline-flex items-center gap-2 mt-1">
                <Sparkline values={ROCE_TREND} width={88} height={24} tone="positive" />
                <span className="text-[10px] wb-text-3">FY19–25</span>
              </span>
            }
          />
          <Metric
            label="Free Cash Flow"
            value={8120}
            format="currency"
            trend={0.09}
            context={
              <span className="inline-flex items-center gap-2 mt-1">
                <Sparkline values={FCF_TREND} width={88} height={24} tone="positive" area />
              </span>
            }
          />
          <Metric
            label="Quarterly surprise"
            value="+2.1pp"
            context={
              <span className="inline-flex items-center mt-2">
                <SparkBars values={QUARTERLY_DELTAS} height={26} />
              </span>
            }
          />
          <Metric
            label="Estimate revision"
            value="-0.8pp"
            context={
              <span className="inline-flex items-center gap-2 mt-1">
                <Sparkline values={[0.5, 0.9, -0.4, -1.1, -0.8, -1.4, -0.8]} width={88} height={24} tone="negative" />
              </span>
            }
          />
        </div>
      </Panel>

      {/* ── Radial + gauge + bullet row ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="Score rings" subtitle="RadialProgress — quality dimensions">
          <div className="flex items-center justify-around py-2">
            {SCORES.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-1.5">
                <RadialProgress value={s.score} size={68} tone={radialToneForScore(s.score)} label={`${Math.round(s.score * 100)}`} />
                <span className="text-[10px] wb-text-3 text-center max-w-[72px]">{s.label}</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Valuation zone" subtitle="GaugeChart — price vs intrinsic range">
          <GaugeChart value={0.62} width={210} valueText="₹1,240" label="vs ₹980–1,450 range" className="py-2" />
        </ChartCard>

        <ChartCard title="Targets" subtitle="BulletChart — actual vs target vs bands">
          <div className="space-y-4 py-1">
            <BulletChart label="ROCE %" value={18.7} target={16} ranges={[12, 16, 22]} format={(v) => `${v.toFixed(0)}%`} tone="positive" />
            <BulletChart label="Asset T/O ×" value={1.42} target={1.6} ranges={[1.0, 1.6, 2.2]} tone="accent" />
            <BulletChart label="Net D/E ×" value={0.34} target={0.25} ranges={[0.25, 0.5, 0.9]} tone="caution" />
          </div>
        </ChartCard>
      </div>

      {/* ── Trend charts ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Margin cascade" subtitle="MultiLineChart — gross → EBITDA → PAT, with target band" status="production">
          <MultiLineChart
            data={MARGIN_LINES}
            series={[
              { key: "gross", label: "Gross margin" },
              { key: "ebitda", label: "EBITDA margin" },
              { key: "pat", label: "PAT margin" },
            ]}
            formatValue={fmtPct}
            formatTooltip={fmtPct}
            referenceBand={{ from: 25, to: 30, label: "EBITDA target" }}
            height={260}
          />
        </ChartCard>

        <ChartCard title="Revenue mix" subtitle="StackedAreaChart — segment composition (₹ Cr)" status="production">
          <StackedAreaChart
            data={REVENUE_MIX}
            series={[
              { key: "staples", label: "Staples" },
              { key: "discretionary", label: "Discretionary" },
              { key: "exports", label: "Exports" },
              { key: "other", label: "Other" },
            ]}
            height={260}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Mix shift (% of total)" subtitle="StackedAreaChart percent mode">
          <StackedAreaChart
            data={REVENUE_MIX}
            series={[
              { key: "staples", label: "Staples" },
              { key: "discretionary", label: "Discretionary" },
              { key: "exports", label: "Exports" },
              { key: "other", label: "Other" },
            ]}
            percent
            height={260}
          />
        </ChartCard>

        <ChartCard title="Accruals vs cash earnings" subtitle="DivergingBarChart — surplus/deficit split at zero" status="guarded">
          <DivergingBarChart entries={ACCRUAL_VS_CASH} height={260} />
        </ChartCard>
      </div>

      {/* ── Composition ──────────────────────────────────────────────── */}
      <ChartCard title="Segment contribution" subtitle="TreemapChart — revenue sized, growth displayed" status="production">
        <TreemapChart entries={SEGMENTS} height={320} />
      </ChartCard>

      {/* ── Growth + peer comparison (new tier) ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Revenue growth" subtitle="CagrOverlayChart — bars + smoothed CAGR path overlay" status="production">
          <CagrOverlayChart
            data={PERIODS.map((p, i) => ({ period: p, value: [9840, 10200, 11200, 12730, 14240, 15850, 17620][i]! }))}
            height={280}
          />
        </ChartCard>
        <ChartCard title="Peer ROCE comparison" subtitle="GroupedBarChart — company vs two peers + sector median" status="production">
          <GroupedBarChart
            data={[
              { period: "FY23", co: 16.8, peerA: 14.2, peerB: 18.1 },
              { period: "FY24", co: 18.4, peerA: 15.6, peerB: 17.3 },
              { period: "FY25", co: 18.7, peerA: 16.4, peerB: 18.9 },
            ]}
            series={[
              { key: "co", label: "ITC" },
              { key: "peerA", label: "HUL" },
              { key: "peerB", label: "Dabur" },
            ]}
            formatValue={(v) => `${v.toFixed(0)}%`}
            formatTooltip={(v) => `${v.toFixed(1)}%`}
            referenceValue={15}
            referenceLabel="Sector median 15%"
            height={280}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Capital employed mix" subtitle="DonutChart — interactive legend, center total" status="production">
          <DonutChart
            entries={[
              { label: "FMCG", value: 24600 },
              { label: "Hotels", value: 5900 },
              { label: "Agri", value: 8200 },
              { label: "Paperboards", value: 7800 },
              { label: "IT", value: 3210 },
            ]}
            centerLabel="₹49.7K Cr"
            centerSub="Capital employed"
            height={240}
          />
        </ChartCard>
        <ChartCard title="Top contributors to FY25 NOPAT" subtitle="HorizontalBarList — tone-aware ranked bars">
          <HorizontalBarList
            entries={[
              { label: "FMCG — Cigarettes", value: 12840, tone: "positive" },
              { label: "Agri Business", value: 1420, tone: "positive" },
              { label: "IT Services", value: 940, tone: "positive" },
              { label: "FMCG — Others", value: -380, tone: "negative" },
              { label: "Hotels", value: 290, tone: "positive" },
              { label: "Paperboards", value: -610, tone: "negative" },
            ]}
            height={260}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="P/E trading range"
          subtitle="RangeBandChart — 7Y historical multiple band, median, current mark"
          status="guarded"
          footnote="Min–max monthly P/E by fiscal year; orange dot = current multiple."
        >
          <RangeBandChart
            data={[
              { period: "FY19", low: 19.2, median: 24.1, high: 29.8 },
              { period: "FY20", low: 17.4, median: 22.6, high: 28.2 },
              { period: "FY21", low: 14.1, median: 17.8, high: 21.6 },
              { period: "FY22", low: 15.9, median: 19.4, high: 24.7 },
              { period: "FY23", low: 18.2, median: 22.9, high: 27.5 },
              { period: "FY24", low: 20.6, median: 25.3, high: 30.1 },
              { period: "FY25", low: 21.8, median: 26.4, high: 31.2 },
            ]}
            currentValue={23.1}
            formatValue={(v) => `${v.toFixed(0)}×`}
            height={260}
          />
        </ChartCard>
      </div>

      {/* ── Probabilistic + correlation ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="Probabilistic value range"
          subtitle="QuantileFanChart — PVRE quantile cone vs market price"
          status="guarded"
          footnote="Quantiles from the seeded Monte-Carlo driver sampler (PVRE engine); reference = last traded price."
        >
          <QuantileFanChart
            band={{ label: "PVRE 5,000-run distribution", q05: 940, q25: 1085, q50: 1240, q75: 1395, q95: 1560 }}
            referencePrice={1102}
            probabilityUndervalued={0.68}
          />
        </ChartCard>

        <ChartCard title="Ratio co-movement" subtitle="CorrelationMatrix — pairwise Pearson ρ across 7Y ratio series">
          <CorrelationMatrix
            labels={["ROCE", "RNOA", "PM", "ATO", "FLEV"]}
            values={[
              [1.00, 0.91, 0.74, 0.32, -0.18],
              [0.91, 1.00, 0.66, 0.41, -0.24],
              [0.74, 0.66, 1.00, -0.12, -0.35],
              [0.32, 0.41, -0.12, 1.00, 0.28],
              [-0.18, -0.24, -0.35, 0.28, 1.00],
            ]}
          />
        </ChartCard>
      </div>

      {/* ── Inline-in-table demo ─────────────────────────────────────── */}
      <Panel title="Dense table embedding" subtitle="Sparkline + SparkBars inside wb-data-table rows">
        <div className="overflow-x-auto">
          <table className="wb-data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="text-right">FY25</th>
                <th className="text-right">Δ YoY</th>
                <th>7Y trend</th>
                <th>Quarterly</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "ROCE %", v: "18.7%", d: "+0.4pp", line: ROCE_TREND.map((x) => x * 100), tone: "positive" as const, bars: QUARTERLY_DELTAS },
                { name: "FCF ₹ Cr", v: "8,120", d: "+9.0%", line: FCF_TREND, tone: "positive" as const, bars: [3, -1, 5, 2, -2, 1, 4, -1] },
                { name: "Receivable days", v: "42d", d: "-3d", line: [51, 49, 52, 48, 46, 45, 42], tone: "positive" as const, bars: [-2, 1, -3, -1, 0, -2, 1, -1] },
                { name: "Inventory days", v: "68d", d: "+5d", line: [58, 61, 59, 62, 64, 63, 68], tone: "negative" as const, bars: [1, 2, -1, 2, 1, 0, 2, 3] },
              ].map((row) => (
                <tr key={row.name}>
                  <td className="font-medium">{row.name}</td>
                  <td className="text-right font-mono">{row.v}</td>
                  <td className={`text-right font-mono ${row.tone === "negative" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{row.d}</td>
                  <td><Sparkline values={row.line} width={84} height={22} tone={row.tone} /></td>
                  <td><SparkBars values={row.bars} height={22} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
