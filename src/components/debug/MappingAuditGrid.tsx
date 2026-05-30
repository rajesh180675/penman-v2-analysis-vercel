/* ── Mapping Coverage Audit panel ─────────────────────────────────
   Extracted verbatim from DebugPanel.tsx. No logic changes. */

import type { MappingAuditReport, QualityGateReport } from "../../engine/mappingAudit";
import { Card, StatBox } from "./debugUi";

export function MappingAuditGrid({
  mappingAudit,
  qualityGate,
}: {
  mappingAudit: MappingAuditReport;
  qualityGate?: QualityGateReport | null | undefined;
}) {
  return (
    <Card title="Mapping Coverage Audit">
      {qualityGate && (
        <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${
          qualityGate.scopeAssessment.blocked
            ? "bg-red-50 border-red-200 text-red-800"
            : qualityGate.tier === "Tier 1"
            ? "bg-green-50 border-green-200 text-green-800"
            : qualityGate.tier === "Tier 2"
              ? "bg-amber-50 border-amber-200 text-amber-900"
              : "bg-red-50 border-red-200 text-red-800"
        }`}>
          <strong>{qualityGate.tier}</strong> · {qualityGate.scopeAssessment.blocked ? "Unsupported scope blocked" : qualityGate.valuationBlocked ? "Valuation blocked" : "Valuation enabled"}
          {qualityGate.blockingReasons.length > 0 && (
            <ul className="list-disc pl-5 mt-2 text-xs space-y-0.5">
              {qualityGate.blockingReasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
      )}
      {qualityGate?.scopeAssessment.signals.length ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <StatBox label="Mapping blocking" value={qualityGate.coverageSummary.unresolvedBySeverity.critical.length} highlight={qualityGate.coverageSummary.unresolvedBySeverity.critical.length > 0 || qualityGate.scopeAssessment.blocked} />
          <StatBox label="Mapping diagnostic" value={qualityGate.coverageSummary.unresolvedBySeverity.warning.length} highlight={qualityGate.coverageSummary.unresolvedBySeverity.warning.length > 0} />
          <StatBox label="Mapping optional" value={qualityGate.coverageSummary.unresolvedBySeverity.info.length} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <StatBox label="Mapping blocking" value={qualityGate?.coverageSummary.unresolvedBySeverity.critical.length ?? 0} highlight={(qualityGate?.coverageSummary.unresolvedBySeverity.critical.length ?? 0) > 0} />
          <StatBox label="Mapping diagnostic" value={qualityGate?.coverageSummary.unresolvedBySeverity.warning.length ?? 0} highlight={(qualityGate?.coverageSummary.unresolvedBySeverity.warning.length ?? 0) > 0} />
          <StatBox label="Mapping optional" value={qualityGate?.coverageSummary.unresolvedBySeverity.info.length ?? 0} />
        </div>
      )}
      {qualityGate?.scopeAssessment.signals.length ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <div className="font-semibold mb-1">Scope signals</div>
          <div>{qualityGate.scopeAssessment.signals.slice(0, 6).map((signal) => `${signal.kind}: ${signal.key}`).join(" · ")}</div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <StatBox label="BS keys in dataset" value={mappingAudit.datasetKeyCounts.BalanceSheet} />
        <StatBox label="PL keys in dataset" value={mappingAudit.datasetKeyCounts.ProfitLoss} />
        <StatBox label="CF keys in dataset" value={mappingAudit.datasetKeyCounts.CashFlow} />
        <StatBox label="Unknown keys" value={mappingAudit.datasetKeyCounts.Unknown} highlight={mappingAudit.datasetKeyCounts.Unknown > 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <StatBox label="Add to spec" value={mappingAudit.backlogSummary.totalsByAction["add-to-spec"]} highlight={mappingAudit.backlogSummary.totalsByAction["add-to-spec"] > 0} />
        <StatBox label="Group existing" value={mappingAudit.backlogSummary.totalsByAction["group-to-existing"]} />
        <StatBox label="Review" value={mappingAudit.backlogSummary.totalsByAction.review} highlight={mappingAudit.backlogSummary.totalsByAction.review > 0} />
        <StatBox label="Ignored" value={mappingAudit.backlogSummary.totalsByAction["ignore-non-core"]} />
        <StatBox label="Actionable" value={mappingAudit.backlogSummary.actionableCount} highlight={mappingAudit.backlogSummary.actionableCount > 0} />
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="font-semibold text-sm text-slate-700 mb-2">Ranked backlog triage</div>
        <div className="text-xs text-slate-500 mb-3">
          Out-of-spec labels are now triaged into spec additions, existing-bucket grouping, ignored disclosure noise, or manual review.
        </div>
        {mappingAudit.backlogSummary.topActionable.length === 0 ? (
          <div className="text-xs text-green-700">No actionable backlog labels remain in this dataset.</div>
        ) : (
          <div className="max-h-64 overflow-auto space-y-2 text-xs">
            {mappingAudit.backlogSummary.topActionable.slice(0, 12).map((entry) => (
              <div key={`${entry.statement}:${entry.key}`} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-slate-800">{entry.statement}:{entry.key}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    entry.triage.action === "add-to-spec"
                      ? "bg-emerald-100 text-emerald-800"
                      : entry.triage.action === "group-to-existing"
                        ? "bg-blue-100 text-blue-800"
                        : entry.triage.action === "review"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-slate-100 text-slate-700"
                  }`}>
                    {entry.triage.action}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                    {entry.triage.priority}
                  </span>
                </div>
                <div className="mt-1 text-slate-600">{entry.triage.rationale}</div>
                <div className="mt-1 text-slate-500">
                  periods {entry.periodsObserved} · non-zero {entry.nonZeroPeriods} · latest {entry.latestValue ?? "—"}
                  {entry.triage.suggestedSpecPath ? ` · spec ${entry.triage.suggestedSpecPath}` : ""}
                  {entry.triage.targetLine ? ` · target ${entry.triage.targetLine}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="border border-slate-200 rounded-lg p-3">
          <div className="font-semibold text-sm text-slate-700 mb-2">Used keys not present in YAML</div>
          <div className="text-xs text-slate-500 mb-2">
            Keys referenced by engine spec but missing from YAML mapping file.
          </div>
          <div className="max-h-40 overflow-auto text-xs font-mono space-y-1">
            {mappingAudit.usedKeysNotInYaml.length === 0 ? (
              <div className="text-green-700">None</div>
            ) : (
              mappingAudit.usedKeysNotInYaml.map((k) => <div key={k}>{k}</div>)
            )}
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg p-3">
          <div className="font-semibold text-sm text-slate-700 mb-2">YAML keys not present in dataset</div>
          <div className="text-xs text-slate-500 mb-2">
            Declared mapping keys not found in uploaded raw metrics.
          </div>
          <div className="max-h-40 overflow-auto text-xs font-mono space-y-1">
            {mappingAudit.yamlKeysNotInDataset.length === 0 ? (
              <div className="text-green-700">None</div>
            ) : (
              mappingAudit.yamlKeysNotInDataset.slice(0, 200).map((k) => <div key={k}>{k}</div>)
            )}
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg p-3">
          <div className="font-semibold text-sm text-slate-700 mb-2">Unresolved critical keys by statement</div>
          <div className="text-xs text-slate-500 mb-2">
            Minimum critical keys missing in dataset by statement.
          </div>
          <div className="text-xs space-y-2">
            {(["BalanceSheet", "ProfitLoss", "CashFlow"] as const).map((s) => (
              <div key={s}>
                <div className="font-semibold text-slate-600">{s}</div>
                {mappingAudit.unresolvedCriticalByStatement[s].length === 0 ? (
                  <div className="text-green-700 font-mono">None</div>
                ) : (
                  <div className="max-h-24 overflow-auto font-mono space-y-0.5">
                    {mappingAudit.unresolvedCriticalByStatement[s].map((k) => <div key={k}>{k}</div>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
