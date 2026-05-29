/* ================================================================
   Plan 2 PR-2.3 — ValuationReport atom components.

   Small presentational pieces lifted from ValuationReport.tsx:
     HeroMetric, StatTile, NumInput, SignalPill, ScenarioCard, ValCard

   These are pure leaves with no React state; the only side they
   touch is rendering. SensitivityGrid stays in ValuationReport
   because its closure depends on the parent's `computeValuation`
   helper.

   Behaviour byte-for-byte identical.
================================================================ */

import {
  formatPerShare,
  formatPct,
  type ValuationSignalState,
} from "../../engine/valuationCommandCenter";

export function HeroMetric({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sublabel}</div>
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type="number" step={0.5} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white" />
    </div>
  );
}

export function SignalPill({ state, label }: { state: ValuationSignalState; label: string }) {
  const classes = state === "blocked"
    ? "border-red-200 bg-red-50 text-red-700"
    : state === "guarded"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : state === "watchlist"
        ? "border-slate-200 bg-slate-100 text-slate-700"
        : state === "interesting"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : state === "high-conviction"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-emerald-300 bg-emerald-100 text-emerald-900";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  );
}

export function ScenarioCard({
  label,
  intrinsicPerShare,
  upsidePct,
  marginOfSafetyPct,
  expectedCagr,
  ke,
  kw,
  g,
  salesGrowth,
  corePm,
  reinvestmentRate,
  incrementalRoic,
  forecastPolicy,
}: {
  label: string;
  intrinsicPerShare: number | null;
  upsidePct: number | null;
  marginOfSafetyPct: number | null;
  expectedCagr: number | null;
  ke: number;
  kw: number;
  g: number;
  salesGrowth: number;
  corePm: number;
  reinvestmentRate: number | null;
  incrementalRoic: number | null;
  forecastPolicy?: {
    terminalAnchorSource?: string | undefined;
    workingCapitalPressure?: string | undefined;
    reinvestmentBurden?: string | undefined;
    balanceSheetFlexibility?: string | undefined;
  } | undefined;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{formatPerShare(intrinsicPerShare)}</div>
      <div className={`mt-1 text-sm font-semibold ${upsidePct != null && upsidePct >= 0 ? "text-emerald-700" : "text-red-700"}`}>
        {formatPct(upsidePct)} vs market
      </div>
      <div className="mt-4 grid gap-2 text-xs text-slate-500">
        <div>ke <strong className="text-slate-700">{formatPct(ke, 2)}</strong></div>
        <div>kw <strong className="text-slate-700">{formatPct(kw, 2)}</strong></div>
        <div>g <strong className="text-slate-700">{formatPct(g, 2)}</strong></div>
        <div>Y1 sales growth <strong className="text-slate-700">{formatPct(salesGrowth, 2)}</strong></div>
        <div>Y1 core PM <strong className="text-slate-700">{formatPct(corePm, 2)}</strong></div>
        <div>Margin of safety <strong className="text-slate-700">{formatPct(marginOfSafetyPct, 1)}</strong></div>
        <div>Expected CAGR <strong className="text-slate-700">{formatPct(expectedCagr, 1)}</strong></div>
        <div>Reinvestment rate <strong className="text-slate-700">{formatPct(reinvestmentRate, 1)}</strong></div>
        <div>
          Incremental ROIC <strong className="text-slate-700">{formatPct(incrementalRoic, 1)}</strong>
          {(incrementalRoic == null || incrementalRoic <= -0.1) ? (
            <span className="ml-1 text-amber-700">(guarded floor)</span>
          ) : null}
        </div>
        {(incrementalRoic == null || incrementalRoic <= -0.1) ? (
          <div className="text-amber-700">Shown as a guarded value because incremental capital turns unstable when ΔNOA is near zero.</div>
        ) : null}
        <div>Terminal anchor <strong className="text-slate-700">{forecastPolicy?.terminalAnchorSource ?? "—"}</strong></div>
        <div>WC pressure <strong className="text-slate-700">{forecastPolicy?.workingCapitalPressure ?? "—"}</strong></div>
        <div>Reinvestment burden <strong className="text-slate-700">{forecastPolicy?.reinvestmentBurden ?? "—"}</strong></div>
        <div>Balance-sheet flexibility <strong className="text-slate-700">{forecastPolicy?.balanceSheetFlexibility ?? "—"}</strong></div>
      </div>
    </div>
  );
}

export function ValCard({ color, title, subtitle, value, items, fmt, perShare, skipReason }: {
  color: "indigo" | "emerald" | "slate";
  title: string;
  subtitle: string;
  /** Phase J2: null when the model fails-closed (e.g., negative net worth). */
  value: number | null;
  items: Array<{ l: string; v: number }>;
  fmt: (n: number) => string;
  perShare?: number | null | undefined;
  /** Phase J2: human-readable reason for skip-with-reason cards. */
  skipReason?: string | null | undefined;
}) {
  const bg = color === "indigo"
    ? "bg-indigo-50 border-indigo-200"
    : color === "emerald"
      ? "bg-emerald-50 border-emerald-200"
      : "bg-slate-50 border-slate-200";
  const hdr = color === "indigo"
    ? "bg-indigo-100 text-indigo-900"
    : color === "emerald"
      ? "bg-emerald-100 text-emerald-900"
      : "bg-slate-100 text-slate-700";
  const vc = color === "indigo"
    ? "text-indigo-700"
    : color === "emerald"
      ? "text-emerald-700"
      : "text-slate-600";
  const isSkipped = value == null;
  return (
    <div className={`rounded-2xl border ${bg} overflow-hidden`}>
      <div className={`px-5 py-4 ${hdr}`}>
        <h3 className="font-bold">{title}</h3>
        <p className="text-xs opacity-70 mt-0.5">{subtitle}</p>
      </div>
      <div className="p-5">
        {isSkipped ? (
          <div>
            <div className="text-2xl font-semibold text-amber-700 mb-2">— Skipped</div>
            {skipReason && (
              <div className="text-xs text-slate-600 leading-relaxed">{skipReason}</div>
            )}
          </div>
        ) : perShare != null ? (
          <>
            <div className={`text-3xl font-bold ${vc} mb-1`}>₹{perShare.toFixed(2)} / share</div>
            <div className="text-sm text-slate-500 mb-3">₹{fmt(value)} Cr total equity value</div>
          </>
        ) : (
          <div className={`text-3xl font-bold ${vc} mb-3`}>₹{fmt(value)} Cr</div>
        )}
        {!isSkipped && items.map((b, i) => (
          <div key={i} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
            <span className="text-slate-600 text-xs">{b.l}</span>
            <span className="font-mono font-semibold text-slate-800">{fmt(b.v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
