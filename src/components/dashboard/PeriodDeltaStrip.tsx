import type { RecastPeriod } from "../../engine/types";

interface Props {
  data: RecastPeriod[];
}

interface DeltaEntry {
  label: string;
  current: number | null;
  prior: number | null;
  format: "currency" | "pct" | "mult";
  /** Direction in which "good" lies (higher = increase good, lower = decrease good) */
  direction: "higher-better" | "lower-better" | "neutral";
}

function fmtDelta(curr: number | null, prior: number | null, fmt: DeltaEntry["format"]): { value: string; pctChange: number | null; absChange: number | null } {
  if (curr == null || prior == null || !Number.isFinite(curr) || !Number.isFinite(prior)) {
    return { value: "—", pctChange: null, absChange: null };
  }
  const absChange = curr - prior;
  const pctChange = prior !== 0 ? absChange / Math.abs(prior) : null;

  let value = "";
  if (fmt === "currency") value = `₹${curr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
  else if (fmt === "pct") value = `${(curr * 100).toFixed(1)}%`;
  else if (fmt === "mult") value = `${curr.toFixed(2)}x`;

  return { value, pctChange, absChange };
}

function deltaColor(pctChange: number | null, direction: DeltaEntry["direction"]): string {
  if (pctChange == null || direction === "neutral") return "text-slate-500";
  const isIncrease = pctChange > 0;
  const isGood = (direction === "higher-better" && isIncrease) || (direction === "lower-better" && !isIncrease);
  if (Math.abs(pctChange) < 0.01) return "text-slate-500";
  return isGood ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

function deltaArrow(pctChange: number | null): string {
  if (pctChange == null) return "—";
  if (Math.abs(pctChange) < 0.005) return "→";
  return pctChange > 0 ? "↑" : "↓";
}

/**
 * Period-over-Period Delta Strip — shows YoY changes for the most important
 * metrics in one row. The single most useful "what changed?" view.
 */
export default function PeriodDeltaStrip({ data }: Props) {
  if (!data || data.length < 2) return null;

  const latest = data[data.length - 1];
  const prior = data[data.length - 2];

  const entries: DeltaEntry[] = [
    { label: "Sales",          current: latest.is.Sales,           prior: prior.is.Sales,           format: "currency", direction: "higher-better" },
    { label: "Operating Inc.", current: latest.is.OI,              prior: prior.is.OI,              format: "currency", direction: "higher-better" },
    { label: "Net Income",     current: latest.is.PAT,             prior: prior.is.PAT,             format: "currency", direction: "higher-better" },
    { label: "ROCE",           current: latest.ratios?.ROCE ?? null, prior: prior.ratios?.ROCE ?? null, format: "pct", direction: "higher-better" },
    { label: "RNOA",           current: latest.ratios?.RNOA ?? null, prior: prior.ratios?.RNOA ?? null, format: "pct", direction: "higher-better" },
    { label: "FLEV",           current: latest.ratios?.FLEV ?? null, prior: prior.ratios?.FLEV ?? null, format: "mult", direction: "lower-better" },
    { label: "CFO",            current: latest.cf?.CFO ?? null,      prior: prior.cf?.CFO ?? null,      format: "currency", direction: "higher-better" },
    { label: "FCF",            current: (latest.cf?.CFO ?? 0) - Math.abs(latest.cf?.Capex ?? 0), prior: (prior.cf?.CFO ?? 0) - Math.abs(prior.cf?.Capex ?? 0), format: "currency", direction: "higher-better" },
  ];

  const period = latest.period_end.slice(0, 7);
  const priorPeriod = prior.period_end.slice(0, 7);

  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900/60 dark:to-slate-800/30 dark:border-slate-700 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">📈</span>
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">What Changed Year-over-Year</h3>
          <p className="text-xs text-slate-500">{priorPeriod} → {period}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {entries.map((e, i) => {
          const { value, pctChange } = fmtDelta(e.current, e.prior, e.format);
          const color = deltaColor(pctChange, e.direction);
          return (
            <div key={i} className="rounded-lg bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{e.label}</div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{value}</div>
              <div className={`text-xs font-mono mt-0.5 ${color}`}>
                {deltaArrow(pctChange)} {pctChange != null ? `${(pctChange * 100).toFixed(1)}%` : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
