/**
 * Case §1 — Verdict. Reads the run's command center — the object the current
 * Valuation hero reads in run-backed mode — through the hero's own formatters,
 * so every number here is the hero's number (Phase 1 parity).
 */
import { useMemo, type ReactNode } from "react";
import { formatPct, formatPerShare } from "../../engine/valuationCommandCenter";
import { solveBreakEvens, type BreakEvenResult } from "../../engine/valuationCommandCenter/breakEven";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { CompanyTrackRecord } from "../../engine/accountability";
import { Withheld } from "../ui/Withheld";

type CommandCenter = NonNullable<LegacyAnalysisRunExecutionResult["materialization"]["commandCenter"]>;

export function VerdictSection({ result, trackRecord = null, asOf = null }: {
  result: LegacyAnalysisRunExecutionResult;
  /** The company's backtest record; null when none exists or it has not loaded. */
  trackRecord?: CompanyTrackRecord | null;
  /** Set when the Case is viewed as of an earlier date. */
  asOf?: string | null;
}) {
  const cc = result.materialization.commandCenter;
  if (!cc) {
    return (
      <Panel>
        <Withheld reason={noCommandCenterReason(result)} />
      </Panel>
    );
  }

  const scenario = (key: "stress" | "base" | "bull") => cc.scenarios.find((s) => s.key === key) ?? null;
  const [stress, base, bull] = [scenario("stress"), scenario("base"), scenario("bull")];
  const noPrice = asOf
    ? `No price as of ${asOf}: the live price is today's, not point-in-time.`
    : `No market price: the live market overlay is ${cc.marketContext.freshness}.`;
  const noValue = cc.shareBasis.shares == null
    ? "No share count could be resolved, so no per-share value."
    : "The model produced no value for this scenario.";

  return (
    <div className="space-y-4">
      <Panel>
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{cc.signal.label}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{cc.signal.summary}</p>
        <TrackRecordLine record={trackRecord} />
      </Panel>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Figure label="Current price">
          {cc.marketPrice != null ? `₹${cc.marketPrice.toFixed(2)}` : <Withheld reason={noPrice} />}
        </Figure>
        <ScenarioFigure label="Stress value" card={stress} priced={cc.marketPrice != null} noValue={noValue} noPrice={noPrice} />
        <ScenarioFigure label="Base value" card={base} priced={cc.marketPrice != null} noValue={noValue} noPrice={noPrice} />
        <ScenarioFigure label="Bull value" card={bull} priced={cc.marketPrice != null} noValue={noValue} noPrice={noPrice} />
        <Figure label="Expected CAGR (stress)">
          {cc.opportunity.expectedCagrStress != null
            ? formatPct(cc.opportunity.expectedCagrStress, 1)
            : <Withheld reason={cc.marketPrice == null ? noPrice : "Not computable for this run."} />}
        </Figure>
      </dl>

      <ValueRange cc={cc} />

      <ChangeOurMind cc={cc} noPrice={noPrice} />

      <p className="text-xs text-slate-500">
        Valued from <strong>{cc.anchorPeriod.period_end}</strong>
        {" · "}latest reported <strong>{cc.marketContext.latestReportedPeriod ?? "—"}</strong>
        {cc.valuationReadiness.status !== "production-ready" && cc.valuationReadiness.reasons[0]
          ? <> · {cc.valuationReadiness.reasons[0]}</>
          : null}
      </p>
    </div>
  );
}

const TRACK_METRICS = [
  ["sales-log-error", "sales"],
  ["core-oi-margin-error", "operating margin"],
  ["cni-roe-point-error", "earnings"],
] as const;

/**
 * How this company's base forecast has done one year ahead against "nothing
 * changes" — counts a reader can check, from the walk-forward backtest.
 */
function TrackRecordLine({ record }: { record: CompanyTrackRecord | null }) {
  const parts = TRACK_METRICS.flatMap(([metric, label]) => {
    const r = record?.oneYearAhead[metric];
    return r ? [`${label} in ${r.beatRandomWalk} of ${r.scored} years`] : [];
  });
  return (
    <p className="mt-3 text-xs text-slate-500">
      <span className="font-medium text-slate-700 dark:text-slate-300">Track record: </span>
      {parts.length
        ? <>one year ahead, the base forecast beat &ldquo;nothing changes&rdquo; on {parts.join("; ")}.</>
        : <Withheld reason="No backtest record for this company." />}
    </p>
  );
}

const DRIVER_LABEL: Record<BreakEvenResult["driver"], string> = {
  sales_growth: "Sales growth (year 1)",
  core_sales_pm: "Core operating margin (year 1)",
  ke: "Cost of equity",
};

/**
 * What would change our mind: for each key base-case driver, the value at
 * which the base case equals today's price (each moved alone).
 */
function ChangeOurMind({ cc, noPrice }: { cc: CommandCenter; noPrice: string }) {
  // The run's command center is deeply readonly; the solver only reads it (it
  // spreads new driver arrays and never mutates), so viewing it through the
  // engine's mutable type is safe — the same seam the current shell uses.
  const results = useMemo(() => solveBreakEvens(cc as unknown as Parameters<typeof solveBreakEvens>[0]), [cc]);
  return (
    <div className="wb-surface rounded-xl border p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">What would change our mind</h2>
      <p className="mt-1 text-xs text-slate-500">The value each base-case driver would need, on its own, for the base case to equal today's price.</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 font-medium">Driver</th>
            <th className="py-1 font-medium">Base case</th>
            <th className="py-1 font-medium">Price requires</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.driver} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-2 text-slate-700 dark:text-slate-300">{DRIVER_LABEL[r.driver]}</td>
              <td className="py-2 font-medium">
                {Number.isFinite(r.base) ? formatPct(r.base, 1) : <Withheld reason="The run has no base-case forecast." />}
              </td>
              <td className="py-2 font-medium">
                {r.breakEven != null
                  ? formatPct(r.breakEven, 1)
                  : <Withheld reason={
                      r.reason === "no-price" ? noPrice
                        : r.reason === "beyond-range" ? "No value within the searched range reaches the price."
                          : "The base case produced no value."
                    } />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function noCommandCenterReason(result: LegacyAnalysisRunExecutionResult): string {
  if (result.status === "failed") return `The analysis failed: ${result.message}`;
  if (result.status === "blocked") return `The analysis was blocked (${result.reasonCode}).`;
  if (result.run.family === "bank" || result.run.family === "nbfc" || result.run.family === "insurance") {
    return "Banks, NBFCs and insurers are valued by the financial-institution models, which arrive in the Valuation section (Phase 3).";
  }
  return "This run produced no valuation.";
}

function ScenarioFigure({ label, card, priced, noValue, noPrice }: {
  label: string;
  card: CommandCenter["scenarios"][number] | null;
  priced: boolean;
  noValue: string;
  noPrice: string;
}) {
  if (!card || card.intrinsicPerShare == null) {
    return <Figure label={label}><Withheld reason={noValue} /></Figure>;
  }
  return (
    <Figure label={label} sub={priced ? `Upside ${formatPct(card.upsidePct)}` : noPrice}>
      {formatPerShare(card.intrinsicPerShare)}
    </Figure>
  );
}

/**
 * The valuation range on one ₹/share axis, with the price marked. One unit
 * throughout, so no two quantities of different scale share the axis.
 */
function ValueRange({ cc }: { cc: CommandCenter }) {
  const points = [
    { key: "floor", label: "Floor", value: cc.range.floorPerShare },
    ...cc.scenarios
      .filter((s) => s.key === "stress" || s.key === "base" || s.key === "bull")
      .map((s) => ({ key: s.key, label: s.label, value: s.intrinsicPerShare })),
    { key: "ceiling", label: "Ceiling", value: cc.range.ceilingPerShare },
  ].filter((p): p is { key: string; label: string; value: number } => p.value != null && Number.isFinite(p.value));
  const price = cc.marketPrice;
  const values = [...points.map((p) => p.value), ...(price != null ? [price] : [])];
  if (points.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const at = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100);

  return (
    <figure className="wb-surface rounded-xl border p-4 shadow-sm" aria-label="Valuation range, ₹ per share">
      <figcaption className="mb-6 text-xs font-medium text-slate-500">Valuation range, ₹ per share</figcaption>
      <div className="relative mx-4 h-10">
        <div className="absolute top-4 h-1 w-full rounded bg-slate-200 dark:bg-slate-700" />
        {points.map((p) => (
          <div key={p.key} className="absolute top-2 -translate-x-1/2 text-center" style={{ left: `${at(p.value)}%` }}>
            <div className="mx-auto h-5 w-0.5 bg-slate-500" />
            <div className="mt-1 whitespace-nowrap text-[10px] text-slate-500">{p.label} {formatPerShare(p.value)}</div>
          </div>
        ))}
        {price != null && (
          <div className="absolute -top-3 -translate-x-1/2 text-center" style={{ left: `${at(price)}%` }}>
            <div className="whitespace-nowrap text-[10px] font-semibold text-sky-700 dark:text-sky-400">Price ₹{price.toFixed(2)}</div>
            <div className="mx-auto h-6 w-0.5 bg-sky-600" />
          </div>
        )}
      </div>
    </figure>
  );
}

/** A card. Not a landmark: the Case page's section is the "Verdict" region. */
function Panel({ children }: { children: ReactNode }) {
  return <div className="wb-surface rounded-xl border p-5 shadow-sm">{children}</div>;
}

function Figure({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="wb-surface rounded-xl border p-4 shadow-sm">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{children}</dd>
      {sub && <dd className="mt-1 text-xs text-slate-500">{sub}</dd>}
    </div>
  );
}
