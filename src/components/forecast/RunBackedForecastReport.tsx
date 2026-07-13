import type { AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import type { SourcedAssumptionSet, UnifiedAnalysisWindow } from "../../engine/analysisCase";
import type { IndustrialForecastCase, IndustrialForecastResult, ScenarioOrderingReport } from "../../engine/forecastState";
import type { ScenarioGovernanceReport } from "../../engine/valuationEvidence";
import type { buildValuationTraceabilitySurfaceSummary } from "../../engine/valuationTraceabilitySummary";
import TraceabilityTrustPanel from "../TraceabilityTrustPanel";
import { SectionHeader } from "../shared/DesignSystem";

interface Props {
  readonly results: readonly IndustrialForecastResult[] | null;
  readonly analysisWindow: UnifiedAnalysisWindow | null;
  readonly assumptions: SourcedAssumptionSet | null;
  readonly ordering: ScenarioOrderingReport | null;
  readonly governance: ScenarioGovernanceReport | null;
  readonly traceability: AnalysisTraceabilityEnvelope | null;
  readonly traceabilitySummary: ReturnType<typeof buildValuationTraceabilitySurfaceSummary>;
}

function number(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toLocaleString("en-IN", { maximumFractionDigits: digits }) : "—";
}

function percent(value: number | null, digits = 1): string {
  return value != null && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function statusClass(status: "passed" | "failed" | "not-applicable" | "confirmed" | "guarded" | "blocked"): string {
  if (status === "passed" || status === "confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "failed" || status === "blocked") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function ProjectionTable({ forecastCase }: { readonly forecastCase: IndustrialForecastCase }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
          <tr>
            <th className="px-3 py-2">Period</th>
            <th className="px-3 py-2 text-right">Revenue</th>
            <th className="px-3 py-2 text-right">OI after tax</th>
            <th className="px-3 py-2 text-right">NOA</th>
            <th className="px-3 py-2 text-right">NFO</th>
            <th className="px-3 py-2 text-right">FCFF</th>
            <th className="px-3 py-2 text-right">Cash bridge</th>
            <th className="px-3 py-2 text-right">BS residual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {forecastCase.projected.map((state) => (
            <tr key={state.stateId}>
              <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{state.periodEnd}</td>
              <td className="px-3 py-2 text-right font-mono">{number(state.incomeStatement.revenue)}</td>
              <td className="px-3 py-2 text-right font-mono">{number(state.incomeStatement.operatingIncomeAfterTax)}</td>
              <td className="px-3 py-2 text-right font-mono">{number(state.balanceSheet.noa)}</td>
              <td className="px-3 py-2 text-right font-mono">{number(state.balanceSheet.nfo)}</td>
              <td className="px-3 py-2 text-right font-mono">{number(state.cashFlow.fcff)}</td>
              <td className="px-3 py-2 text-right font-mono">{number(state.diagnostics.cashBridgeResidual, 4)}</td>
              <td className="px-3 py-2 text-right font-mono">{number(state.diagnostics.balanceSheetResidual, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RunBackedForecastReport({
  results,
  analysisWindow,
  assumptions,
  ordering,
  governance,
  traceability,
  traceabilitySummary,
}: Props) {
  if (results === null) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
        The immutable analysis run is preparing forecast cases. No browser-side fallback valuation is being computed.
      </div>
    );
  }

  const computed = results.flatMap((result) => result.status === "computed" ? [result.forecastCase] : []);
  const blocked = results.flatMap((result) => result.status === "blocked" ? [result] : []);

  return (
    <div className="space-y-6">
      {traceability && traceabilitySummary && (
        <TraceabilityTrustPanel
          title="Forecast trust envelope"
          summary={traceabilitySummary}
          confidenceStatus={traceability.confidence.status}
          rigorLabel={traceability.rigor.currentLabel}
          parserStatus={traceability.parserFidelity.status}
          reconciliationStatus={traceability.reconciliation.status}
          cautionHeading="Forecast publication blockers"
        />
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <SectionHeader
          title="Run-pinned forecast state"
          subtitle="Projected statements are explicit balanced states produced once by the AnalysisRun worker; historical recast objects are not cloned into the forecast."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
            <div className="text-xs uppercase tracking-wide text-slate-500">Window anchor</div>
            <div className="mt-1 font-semibold">{analysisWindow?.anchorPeriod ?? "Unavailable"}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
            <div className="text-xs uppercase tracking-wide text-slate-500">Window periods</div>
            <div className="mt-1 font-semibold">{analysisWindow?.includedPeriods.length ?? 0}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
            <div className="text-xs uppercase tracking-wide text-slate-500">Sourced assumptions</div>
            <div className="mt-1 font-semibold">{assumptions?.assumptions.length ?? 0}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
            <div className="text-xs uppercase tracking-wide text-slate-500">Ordering</div>
            <div className="mt-1 font-semibold">{ordering?.status ?? "not-applicable"}</div>
          </div>
        </div>
        {ordering && (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${statusClass(ordering.status)}`}>
            {ordering.summary}
          </div>
        )}
        {governance && (
          <div className={`mt-4 rounded-xl border px-4 py-4 text-sm ${statusClass(governance.status)}`} data-testid="scenario-governance">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>Scenario governance: {governance.status}</strong>
              <span>{governance.rangeEligible ? "Range eligible" : "Diagnostic range"} · {governance.pointEstimateEligible ? "Point estimate eligible" : "Point estimate withheld"}</span>
            </div>
            <p className="mt-2">{governance.summary}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div>Low <strong>₹{number(governance.uncertaintyRange.lowPerShare ?? Number.NaN, 2)}</strong></div>
              <div>Base <strong>₹{number(governance.uncertaintyRange.basePerShare ?? Number.NaN, 2)}</strong></div>
              <div>High <strong>₹{number(governance.uncertaintyRange.highPerShare ?? Number.NaN, 2)}</strong></div>
            </div>
            <div className="mt-2 text-xs">
              Assumption provenance: {(governance.assumptionProvenance.coverageRatio * 100).toFixed(0)}% · calibrated probabilities {governance.calibratedProbabilityCount}/{governance.computedScenarioCount}
            </div>
          </div>
        )}
      </section>

      {blocked.length > 0 && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          <h2 className="font-semibold">Blocked forecast cases</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {blocked.map((result) => <li key={result.caseId}>{result.caseId}: {result.reasonCodes.join(", ")}</li>)}
          </ul>
        </section>
      )}

      {computed.map((forecastCase) => (
        <section key={forecastCase.caseId} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{forecastCase.label}</h2>
              <p className="text-sm text-slate-500">
                {forecastCase.horizonYears} years · {forecastCase.validation.status} validation · probability {forecastCase.probabilityStatus}
              </p>
            </div>
            <div className="flex gap-2 text-xs">
              <span className={`rounded-full border px-3 py-1 ${statusClass(forecastCase.validation.status)}`}>{forecastCase.validation.status}</span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">{percent(forecastCase.probability)}</span>
            </div>
          </div>
          <ProjectionTable forecastCase={forecastCase} />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">Terminal growth <strong>{percent(forecastCase.terminal.growth)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">Terminal ROIC <strong>{percent(forecastCase.terminal.roic)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">Reinvestment <strong>{percent(forecastCase.terminal.reinvestmentRate)}</strong></div>
          </div>
        </section>
      ))}

      {computed.length === 0 && blocked.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          This run did not publish an industrial ForecastState case. The absence is explicit; no local fallback forecast is substituted.
        </div>
      )}
    </div>
  );
}
