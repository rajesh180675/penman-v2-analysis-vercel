import { RawPeriodData } from "../../engine/types";
import { summarizeUnmappedLabels } from "../../engine/conceptOntology";
import { MetricCard } from "./fields";
import { unmappedLabelsMetric } from "./unmappedLabelsMetric";

interface ConceptCoverage {
  coveragePct: number;
  coreMatchedCount: number;
  coreTotalCount: number;
  unresolvedCore: string[];
}

interface StatementDiagnosticsReport {
  diagnostics: Array<{
    label: string;
    periodEnd?: string | null | undefined;
    detail: string;
  }>;
}

interface CorporateAction {
  kind: string;
  periodEnd: string;
  confidence: string | number;
  detail: string;
}

interface Props {
  rawData: RawPeriodData[] | null;
  conceptCoverage: ConceptCoverage;
  statementDiagnostics: StatementDiagnosticsReport;
  corporateActions: CorporateAction[];
}

export default function DiagnosticsSection({
  rawData,
  conceptCoverage,
  statementDiagnostics,
  corporateActions,
}: Props) {
  return (
    <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-bold text-slate-800">Concept Ontology Coverage</h3>
        <p className="mt-1 text-sm text-slate-500">This shows whether the loaded statements cover the analytical concepts the model cares about, not just raw line counts.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MetricCard label="Coverage" value={`${(conceptCoverage.coveragePct * 100).toFixed(0)}%`} />
          <MetricCard label="Core matched" value={`${conceptCoverage.coreMatchedCount}/${conceptCoverage.coreTotalCount}`} />
          {/* Was `label="Top unmapped"` over `rankUnmappedLabels(rawData, 8).length`
              — a value capped at 8 by its own limit argument, so it printed 8 for
              all 33 bundled companies while the counts ran 216 to 2,334. "Top"
              also promised a list nothing rendered. */}
          <MetricCard label="Unmapped labels" value={unmappedLabelsMetric(summarizeUnmappedLabels(rawData))} />
        </div>
        <div className="mt-4 space-y-2 text-sm text-slate-700">
          {conceptCoverage.unresolvedCore.length ? (
            conceptCoverage.unresolvedCore.map((item) => (
              <div key={item} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">{item}</div>
            ))
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">All core ontology concepts have a live statement match.</div>
          )}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-bold text-slate-800">Statement Diagnostics And Corporate Actions</h3>
        <div className="mt-4 space-y-2 text-sm text-slate-700">
          {statementDiagnostics.diagnostics.slice(0, 6).map((item) => (
            <div key={`${item.label}:${item.periodEnd ?? "na"}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="font-medium text-slate-800">{item.label}</div>
              <div className="text-xs text-slate-500">{item.periodEnd?.slice(0, 10) ?? "—"}</div>
              <div className="mt-1">{item.detail}</div>
            </div>
          ))}
          {!statementDiagnostics.diagnostics.length && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">No major presentation or scale discontinuities were detected in the loaded history.</div>
          )}
          {corporateActions.slice(0, 4).map((item) => (
            <div key={`${item.kind}:${item.periodEnd}`} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
              <div className="font-medium">{item.kind}</div>
              <div className="text-xs opacity-70">{item.periodEnd.slice(0, 10)} · confidence {item.confidence}</div>
              <div className="mt-1">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
