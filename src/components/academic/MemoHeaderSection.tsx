import { RecastPeriod } from "../../engine/types";
import { pct, num } from "./AcademicReport.formatters";
import { Kpi } from "./AcademicUi";
import type { QualityGate, Traceability, ValuationReadiness, Valuation } from "./AcademicReport.types";

interface Issue { title: string }

export function MemoHeaderSection(props: {
  companyId: string;
  first: RecastPeriod;
  latest: RecastPeriod;
  valuationReadiness: ValuationReadiness;
  qualityGate: QualityGate;
  traceability: Traceability;
  blockingIssues: Issue[];
  diagnosticIssues: Issue[];
  optionalIssues: Issue[];
  primaryValuation: number | null;
  valuation: Valuation;
}) {
  const {
    companyId,
    first,
    latest,
    valuationReadiness,
    qualityGate,
    traceability,
    blockingIssues,
    diagnosticIssues,
    optionalIssues,
    primaryValuation,
    valuation,
  } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-800">Investor Research Memorandum (Academic Format)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Framework: Nissim &amp; Penman (2001), residual-income valuation with operating/financing recast under Ind AS.
        </p>
        <p className="text-xs text-slate-600 mt-2">Company ID: <b>{companyId}</b> · Sample window: <b>{first.period_end.slice(0, 10)}</b> to <b>{latest.period_end.slice(0, 10)}</b>.
          {/* S-11.1: contamination guard — display ke/kw derivation info */}
          {valuationReadiness.status !== "production-ready" && (
            <span className="ml-2 text-amber-700 font-semibold">
              Guarded valuation mode — anchor period {valuationReadiness.anchorPeriod?.slice(0, 10) ?? "n/a"}.
            </span>
          )}
        </p>
        {qualityGate && (
          <div className={`mt-4 rounded-xl border p-4 text-sm ${
            qualityGate.scopeAssessment.blocked
              ? "border-red-200 bg-red-50 text-red-900"
              : qualityGate.valuationBlocked
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-green-200 bg-green-50 text-green-900"
          }`}>
            <div className="font-semibold">
              Mapping / scope status: {qualityGate.scopeAssessment.blocked ? "blocking" : qualityGate.valuationBlocked ? "guarded" : "clear"}
            </div>
            <div className="mt-1 text-xs">
              {qualityGate.scopeAssessment.blocked
                ? `${qualityGate.scopeAssessment.label}. ${qualityGate.scopeAssessment.recommendedAction}`
                : qualityGate.valuationBlocked
                  ? qualityGate.blockingReasons[0] ?? "Valuation is blocked until critical issues are resolved."
                  : "Valuation-critical mapping coverage is clear for this dataset."}
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-red-200 bg-white/70 p-3">
                <div className="text-[11px] uppercase tracking-wide text-red-700">Blocking</div>
                <div className="mt-1 text-lg font-bold">{blockingIssues.length}</div>
                <div className="mt-1 text-xs">{blockingIssues.slice(0, 2).map((issue) => issue.title).join(", ") || "None"}</div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-white/70 p-3">
                <div className="text-[11px] uppercase tracking-wide text-amber-700">Diagnostic</div>
                <div className="mt-1 text-lg font-bold">{diagnosticIssues.length}</div>
                <div className="mt-1 text-xs">{diagnosticIssues.slice(0, 2).map((issue) => issue.title).join(", ") || "None"}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white/70 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-600">Optional</div>
                <div className="mt-1 text-lg font-bold">{optionalIssues.length}</div>
                <div className="mt-1 text-xs">{optionalIssues.slice(0, 2).map((issue) => issue.title).join(", ") || "None"}</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-slate-600">
              Traceability schema {traceability.schemaVersion} · engine {traceability.policyVersions.engineVersion} · scope policy {traceability.policyVersions.scopePolicyVersion}
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              Run {traceability.runContext.runId ? traceability.runContext.runId.slice(0, 8) : "—"} · source {traceability.runContext.sourceMode ?? "—"} · actionable backlog {traceability.mappingCoverage.actionableOutOfSpecLabelCount} · review queue {traceability.mappingCoverage.backlogByAction.review}
            </div>
          </div>
        )}
        {valuationReadiness.status !== "production-ready" && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-semibold">Valuation status: {valuationReadiness.status}</div>
            <div className="mt-1">{valuationReadiness.reasons[0]}</div>
            {valuationReadiness.terminalFlagLabels.length > 0 && (
              <div className="mt-2 text-xs">
                Terminal flags: <b>{valuationReadiness.terminalFlagLabels.join(", ")}</b>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5">
          <Kpi label="Latest ROCE" value={pct(latest.ratios?.ROCE)} />
          <Kpi label="Latest RNOA" value={pct(latest.ratios?.RNOA)} />
          {/* S-11.5: use guarded (primaryValuation) when contamination tier is GUARDED/COMPROMISED */}
          <Kpi label={valuationReadiness.status !== "production-ready" ? "V(RE,CV3) [guarded]" : "V(RE, CV3)"} value={`₹${num(primaryValuation ?? valuation.V_RE_CV3)} Cr`} />
          <Kpi label="Separation Confidence" value={`${latest.bs.separationScore}/100`} />
        </div>
      </section>
  );
}
