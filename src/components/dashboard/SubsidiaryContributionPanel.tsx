/**
 * SubsidiaryContributionPanel — visualizes the gap between consolidated and
 * standalone financial data. The gap = subsidiary contribution.
 *
 * Why this matters:
 *   - Indian companies file BOTH consolidated (parent + subsidiaries) AND
 *     standalone (parent only). The difference reveals what subsidiaries do.
 *   - Critical for SOTP cross-validation: if your segment definitions assign
 *     30% of value to subsidiaries but the gap shows they only earn 5% of PAT,
 *     the SOTP is overweighting subsidiaries.
 *   - Catches inter-company dividend leakage in standalone "Other Income".
 *   - Detects structural shifts (parent shrinking vs subsidiaries growing).
 */

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { ScopeAwareResult, SubsidiaryContribution } from "../../engine/scopeAwareLoader";

interface Props {
  result: ScopeAwareResult;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

const fmtCr = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
};

const fmtPct = (v: number | null | undefined, dp = 1): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(dp)}%`;
};

// ─── Red-flag detection ──────────────────────────────────────────────────────

interface RedFlag {
  severity: "info" | "warning" | "alert";
  title: string;
  detail: string;
}

function detectRedFlags(result: ScopeAwareResult): RedFlag[] {
  const flags: RedFlag[] = [];
  const { summary, subsidiaryContribution } = result;
  const median = summary.medianPatContributionPct;

  // Flag 1: Subsidiary contribution dominance
  if (median != null) {
    if (median < 0.05) {
      flags.push({
        severity: "info",
        title: "Parent dominates",
        detail: `Subsidiaries contribute only ${(median * 100).toFixed(1)}% of consolidated PAT. SOTP analysis is unlikely to add value over straight consolidated valuation.`,
      });
    } else if (median > 0.30) {
      flags.push({
        severity: "warning",
        title: "Significant subsidiary footprint",
        detail: `Subsidiaries contribute ${(median * 100).toFixed(1)}% of consolidated PAT. SOTP valuation recommended; segment definitions should reflect at least this much subsidiary value.`,
      });
    }
  }

  // Flag 2: Negative subsidiary contribution = standalone PAT > consolidated PAT
  // Either subsidiary losses, or inter-company dividend leakage in standalone.
  const negativeContributionPeriods = subsidiaryContribution.filter(
    (c) => c.bothAvailable && c.patContribution != null && c.patContribution < 0
  );
  if (negativeContributionPeriods.length > 0) {
    const examples = negativeContributionPeriods
      .slice(-3)
      .map((c) => c.period_end.slice(0, 10))
      .join(", ");
    flags.push({
      severity: "alert",
      title: "Standalone PAT exceeds consolidated",
      detail: `In ${negativeContributionPeriods.length} period(s) (e.g. ${examples}), standalone PAT > consolidated PAT. Likely cause: subsidiary losses dragging consolidated down, OR inter-company dividend received by parent inflating standalone "Other Income". Investigate before using standalone metrics in isolation.`,
    });
  }

  // Flag 3: Trend change
  if (summary.patContributionTrend === "growing") {
    flags.push({
      severity: "info",
      title: "Subsidiaries are growing relative to parent",
      detail: "Subsidiary PAT contribution is trending upward. Strategic shift toward non-parent businesses; SOTP terminal-value assumptions should reflect this.",
    });
  } else if (summary.patContributionTrend === "shrinking") {
    flags.push({
      severity: "info",
      title: "Subsidiaries shrinking relative to parent",
      detail: "Parent business is taking share back from subsidiaries. May indicate divestment, subsidiary underperformance, or parent operating leverage.",
    });
  }

  // Flag 4: Period coverage mismatch
  if (result.consolidatedOnlyPeriods.length > 0 || result.standaloneOnlyPeriods.length > 0) {
    flags.push({
      severity: "warning",
      title: "Period coverage mismatch",
      detail: `${result.consolidatedOnlyPeriods.length} consolidated-only period(s), ${result.standaloneOnlyPeriods.length} standalone-only period(s). Gap analysis only runs on aligned periods.`,
    });
  }

  return flags;
}

// ─── Chart data shaping ──────────────────────────────────────────────────────

interface ChartRow {
  period: string;
  parentPat: number | null;
  subsidiaryPat: number | null;
  contributionPct: number | null;
}

function buildChartData(contributions: SubsidiaryContribution[]): ChartRow[] {
  return contributions
    .filter((c) => c.bothAvailable && c.patContribution != null)
    .map((c) => ({
      period: c.period_end.slice(0, 7), // YYYY-MM
      // Parent PAT = consolidated − subsidiary contribution (it equals standalone PAT)
      // We display it as the bottom layer of the stacked area
      parentPat: c.patContribution != null ? null : null, // placeholder, filled below
      subsidiaryPat: c.patContribution,
      contributionPct: c.patContributionPct,
    }));
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export default function SubsidiaryContributionPanel({ result }: Props) {
  const flags = useMemo(() => detectRedFlags(result), [result]);
  const chartData = useMemo(() => buildChartData(result.subsidiaryContribution), [result.subsidiaryContribution]);
  const { summary, subsidiaryContribution } = result;

  if (!result.scopeAwareAnalysisAvailable) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4">
        <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-1">Scope-aware analysis unavailable</h3>
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Could not align consolidated and standalone periods. Check that both datasets cover overlapping fiscal years.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Subsidiary Contribution Analysis</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Gap between consolidated (parent + subsidiaries) and standalone (parent only) financials.
          Reveals what subsidiaries contribute to the group.
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Aligned Periods"
          value={summary.alignedPeriods.toString()}
          sublabel="overlapping years"
        />
        <KpiCard
          label="Median Subsidiary PAT"
          value={fmtPct(summary.medianPatContributionPct)}
          sublabel="of consolidated PAT"
          accent={
            summary.medianPatContributionPct == null ? "neutral" :
            summary.medianPatContributionPct > 0.30 ? "high" :
            summary.medianPatContributionPct < 0.05 ? "low" : "mid"
          }
        />
        <KpiCard
          label="Median Subsidiary Sales"
          value={fmtPct(summary.medianSalesContributionPct)}
          sublabel="of consolidated revenue"
        />
        <KpiCard
          label="Trend"
          value={
            summary.patContributionTrend === "growing" ? "↑ Growing" :
            summary.patContributionTrend === "shrinking" ? "↓ Shrinking" :
            summary.patContributionTrend === "stable" ? "→ Stable" :
            "—"
          }
          sublabel="subsidiary PAT share"
          accent={
            summary.patContributionTrend === "growing" ? "high" :
            summary.patContributionTrend === "shrinking" ? "low" : "neutral"
          }
        />
      </div>

      {/* Red flags */}
      {flags.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Analysis Notes</h3>
          <div className="space-y-2">
            {flags.map((f, i) => (
              <FlagCard key={i} flag={f} />
            ))}
          </div>
        </section>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Subsidiary PAT Contribution Over Time</h3>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-4">
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString("en-IN")} />
                  <Tooltip
                    formatter={((value: unknown, name: unknown) => {
                      if (name === "Subsidiary PAT (₹ Cr)" && typeof value === "number") return [fmtCr(value), name];
                      return [String(value ?? "—"), String(name ?? "")];
                    }) as never}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="subsidiaryPat"
                    name="Subsidiary PAT (₹ Cr)"
                    stroke="#6366F1"
                    fill="#6366F1"
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* Period-by-period table */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Period-by-Period Breakdown</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Period</th>
                <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 text-right">Sales Δ (₹ Cr)</th>
                <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 text-right">Sales %</th>
                <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 text-right">PAT Δ (₹ Cr)</th>
                <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 text-right">PAT %</th>
                <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 text-right">NOA Δ (₹ Cr)</th>
                <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 text-right">NOA %</th>
              </tr>
            </thead>
            <tbody>
              {subsidiaryContribution.map((c) => (
                <tr key={c.period_end} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 font-mono text-xs">{c.period_end.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCr(c.salesContribution)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(c.salesContributionPct)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${
                    c.patContribution != null && c.patContribution < 0 ? "text-rose-600 dark:text-rose-400 font-semibold" : ""
                  }`}>{fmtCr(c.patContribution)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(c.patContributionPct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCr(c.noaContribution)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(c.noaContributionPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          Δ = Consolidated − Standalone. % = Δ as fraction of consolidated.
          Negative values indicate subsidiary losses or inter-company dividend recognized in standalone "Other Income".
        </p>
      </section>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sublabel?: string;
  accent?: "high" | "mid" | "low" | "neutral";
}

function KpiCard({ label, value, sublabel, accent = "neutral" }: KpiCardProps) {
  const accentClasses = {
    high: "text-amber-700 dark:text-amber-300",
    mid: "text-indigo-700 dark:text-indigo-300",
    low: "text-emerald-700 dark:text-emerald-300",
    neutral: "text-slate-800 dark:text-slate-100",
  };
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${accentClasses[accent]}`}>{value}</div>
      {sublabel && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sublabel}</div>}
    </div>
  );
}

function FlagCard({ flag }: { flag: RedFlag }) {
  const styles = {
    info:    "border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800",
    warning: "border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800",
    alert:   "border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800",
  };
  const titleColors = {
    info:    "text-blue-900 dark:text-blue-200",
    warning: "text-amber-900 dark:text-amber-200",
    alert:   "text-rose-900 dark:text-rose-200",
  };
  const icons = { info: "ℹ️", warning: "⚠️", alert: "🚨" };
  return (
    <div className={`rounded-lg border p-3 ${styles[flag.severity]}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">{icons[flag.severity]}</span>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${titleColors[flag.severity]}`}>{flag.title}</div>
          <div className="text-xs text-slate-700 dark:text-slate-300 mt-1">{flag.detail}</div>
        </div>
      </div>
    </div>
  );
}
