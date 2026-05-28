import { useMemo } from "react";
import { CompanyRegistry, EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { runPhase0BaselineReport } from "../engine/regressionHarness";
import { PHASE0_BENCHMARK_SET } from "../engine/baselineGuardrails";
import { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import { buildValuationTraceabilitySurfaceSummary } from "../engine/valuationTraceabilitySummary";
import TraceabilityTrustPanel from "./TraceabilityTrustPanel";
import { SectionHeader } from "./shared/DesignSystem";

interface Props {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  registry: CompanyRegistry;
  traceability?: AnalysisTraceabilityEnvelope | null | undefined;
  traceabilitySummary?: ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null | undefined;
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 0 }));

export default function RegressionReport({ rawData, recastData, config, registry, traceability = null, traceabilitySummary: precomputedTraceabilitySummary = null }: Props) {
  const baseline = useMemo(() => {
    if (!rawData || !recastData) return null;
    return runPhase0BaselineReport(rawData, recastData, config);
  }, [rawData, recastData, config]);
  const report = baseline?.regression ?? null;
  const snapshot = baseline?.snapshot ?? null;
  const derivedTraceabilitySummary = useMemo(
    () => buildValuationTraceabilitySurfaceSummary(traceability),
    [traceability],
  );
  const traceabilitySummary = precomputedTraceabilitySummary ?? derivedTraceabilitySummary;

  if (!report) {
return (
      <div className="card-base p-12 text-center">
        <div className="text-5xl mb-3">🧪</div>
        <p className="font-semibold text-slate-600 dark:text-slate-300">Need uploaded raw data + 2+ recast periods</p>
        <p className="text-sm text-slate-500 mt-1">Run analysis first, then open this tab for before/after regression deltas.</p>
      </div>
    );
  }

return (
    <div className="space-y-6">
      <SectionHeader
        title="Regression"
        subtitle="Before/after regression deltas — did the latest data change the engine outputs?"
        icon="🧪"
      />

      {traceabilitySummary && (
        <TraceabilityTrustPanel
          title="Regression Trust Gate"
          summary={traceabilitySummary}
          confidenceStatus={traceability?.confidence.status}
          rigorLabel={traceability?.rigor.currentLabel}
          parserStatus={traceability?.parserFidelity.status}
          reconciliationStatus={traceability?.reconciliation.status}
          cautionHeading="Read regression deltas in the context of these unresolved gates"
        />
      )}
      <section className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800">Post-Fix Regression Harness</h2>
        <p className="text-xs text-slate-500 mt-1">
          Company run-through on {report.latestPeriod.slice(0, 10)} with legacy-emulation (before) vs fixed engine (after).
        </p>
      </section>
      {snapshot && (
        <>
          <section className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-3">Phase 0 Baseline Universe (Frozen)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-left">Company</th>
                    <th className="px-3 py-2 text-left">Sector</th>
                    <th className="px-3 py-2 text-left">Loaded in session</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {PHASE0_BENCHMARK_SET.map((c) => {
                    const loaded = Object.prototype.hasOwnProperty.call(registry.companies, c.id);
                    return (
                      <tr key={c.id}>
                        <td className="px-3 py-2 font-mono">{c.ticker}</td>
                        <td className="px-3 py-2 text-slate-700">{c.name}</td>
                        <td className="px-3 py-2 text-slate-600">{c.sector}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${loaded ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                            {loaded ? "Yes" : "No"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-3">Phase 0 Guardrails KPI Dashboard</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Box label="RE↔ReOI identity gap" value={pct(snapshot.guardrails.identityGapPct)} />
              <Box label="% Other OA" value={pct(snapshot.guardrails.otherOAPct)} />
              <Box label="Terminal-anchor stability" value={pct(snapshot.guardrails.terminalAnchorStabilityPct)} />
              <Box
                label="Valuation error band"
                value={`${pct(snapshot.guardrails.valuationErrorBand.downsidePct)} / +${(snapshot.guardrails.valuationErrorBand.upsidePct * 100).toFixed(2)}%`}
              />
            </div>
          </section>
          <section className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-3">Reproducible Baseline Snapshot</h3>
            <p className="text-xs text-slate-500 mb-3">
              Deterministic snapshot ID for regression harness baselining and CI comparisons.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <Box label="Snapshot ID" value={snapshot.snapshotId} />
              <Box label="Config fingerprint" value={snapshot.configFingerprint} />
              <Box label="Benchmark members" value={String(snapshot.benchmarkUniverse.length)} />
            </div>
            <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto">
              {JSON.stringify(snapshot, null, 2)}
            </pre>
          </section>
        </>
      )}

      <section className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">1) Before vs After Ratio Deltas (latest period)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-right">Before</th>
                <th className="px-3 py-2 text-right">After</th>
                <th className="px-3 py-2 text-right">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ["ROCE", report.ratioDelta.ROCE_before, report.ratioDelta.ROCE_after],
                ["RNOA", report.ratioDelta.RNOA_before, report.ratioDelta.RNOA_after],
                ["NBC", report.ratioDelta.NBC_before, report.ratioDelta.NBC_after],
              ].map(([m, b, a]) => (
                <tr key={m as string}>
                  <td className="px-3 py-2 font-medium text-slate-700">{m as string}</td>
                  <td className="px-3 py-2 text-right font-mono">{pct(b as number | null)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{pct(a as number | null)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {b != null && a != null ? pct((a as number) - (b as number)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">2) Identity Pass Rate A1–A9 (before vs after)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="text-xs uppercase text-red-700 font-semibold">Before (legacy emulation)</div>
            <div className="text-xl font-bold text-red-800 mt-1">
              {report.identityPass.before.passed}/{report.identityPass.before.total}
              <span className="text-sm ml-2">({(report.identityPass.before.rate * 100).toFixed(1)}%)</span>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs uppercase text-emerald-700 font-semibold">After (fixed engine)</div>
            <div className="text-xl font-bold text-emerald-800 mt-1">
              {report.identityPass.after.passed}/{report.identityPass.after.total}
              <span className="text-sm ml-2">({(report.identityPass.after.rate * 100).toFixed(1)}%)</span>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-2 text-left">Assertion</th>
                <th className="px-2 py-2 text-right">Before pass</th>
                <th className="px-2 py-2 text-right">After pass</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {Object.entries(report.identityPass.byAssertion).map(([id, v]) => (
                <tr key={id}>
                  <td className="px-2 py-2 text-slate-700">{id}</td>
                  <td className="px-2 py-2 text-right">{v.beforePass}/{v.beforeTotal}</td>
                  <td className="px-2 py-2 text-right text-emerald-700">{v.afterPass}/{v.afterTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">3) Valuation Delta (RE/ReOI CV outputs)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Box label="ke" value={pct(report.valuationDelta.ke)} />
          <Box label="kw before (legacy)" value={pct(report.valuationDelta.kw_before)} />
          <Box label="kw after (fixed)" value={pct(report.valuationDelta.kw_after)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Valuation output</th>
                <th className="px-3 py-2 text-right">Before</th>
                <th className="px-3 py-2 text-right">After</th>
                <th className="px-3 py-2 text-right">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              <tr>
                <td className="px-3 py-2 text-slate-700">V_RE_CV3</td>
                <td className="px-3 py-2 text-right">₹{num(report.valuationDelta.V_RE_CV3_before)}</td>
                <td className="px-3 py-2 text-right text-emerald-700">₹{num(report.valuationDelta.V_RE_CV3_after)}</td>
                <td className="px-3 py-2 text-right">
                  {report.valuationDelta.V_RE_CV3_after != null && report.valuationDelta.V_RE_CV3_before != null
                    ? `₹${num(report.valuationDelta.V_RE_CV3_after - report.valuationDelta.V_RE_CV3_before)}`
                    : "—"}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-slate-700">V_ReOI_CV03</td>
                <td className="px-3 py-2 text-right">₹{num(report.valuationDelta.V_ReOI_CV03_before)}</td>
                <td className="px-3 py-2 text-right text-emerald-700">₹{num(report.valuationDelta.V_ReOI_CV03_after)}</td>
                <td className="px-3 py-2 text-right">₹{num(report.valuationDelta.V_ReOI_CV03_after - report.valuationDelta.V_ReOI_CV03_before)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">4) Fixed-Bugs Impact Table (quantitative attribution)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Bug class</th>
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-right">Before</th>
                <th className="px-3 py-2 text-right">After</th>
                <th className="px-3 py-2 text-right">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.bugImpactTable.map((r) => (
                <tr key={`${r.bugClass}-${r.metric}`}>
                  <td className="px-3 py-2 text-slate-700">{r.bugClass}</td>
                  <td className="px-3 py-2 text-slate-600 font-mono">{r.metric}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.before == null ? "—" : Math.abs(r.before) < 2 ? pct(r.before) : `₹${num(r.before)}`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">
                    {r.after == null ? "—" : Math.abs(r.after) < 2 ? pct(r.after) : `₹${num(r.after)}`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.delta == null ? "—" : Math.abs(r.delta) < 2 ? pct(r.delta) : `₹${num(r.delta)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="font-semibold text-slate-800 mt-1">{value}</div>
    </div>
  );
}
