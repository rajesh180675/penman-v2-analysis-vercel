/* ── Mapping Coverage Audit panel ─────────────────────────────────
   Extracted verbatim from DebugPanel.tsx. No logic changes. */

import type { MappingAuditReport, QualityGateReport } from "../../engine/mappingAudit";
import type { BacklogTriageAction } from "../../engine/mappingBacklogPolicy";
import { capped } from "../cappedList";
import { Card, StatBox } from "./debugUi";

const BACKLOG_SHOWN = 12;
const SCOPE_SIGNALS_SHOWN = 6;

/* Typed as the full action union, so adding a fifth triage action fails the
   build here rather than silently dropping a bucket out of the strip while the
   caption keeps claiming a total. */
const ACTION_ORDER: readonly BacklogTriageAction[] = [
  "add-to-spec",
  "group-to-existing",
  "review",
  "ignore-non-core",
];

const ACTION_LABELS: Record<BacklogTriageAction, string> = {
  "add-to-spec": "Add to spec",
  "group-to-existing": "Group existing",
  review: "Review",
  "ignore-non-core": "Ignored",
};

/** Amber only where a non-zero count is something to act on. */
const HIGHLIGHT_ACTIONS = new Set<BacklogTriageAction>(["add-to-spec", "review"]);

export function MappingAuditGrid({
  mappingAudit,
  qualityGate,
}: {
  mappingAudit: MappingAuditReport;
  qualityGate?: QualityGateReport | null | undefined;
}) {
  // Two truncations stacked, so this list's own length is not the total.
  // `summarizeMappingBacklog` already `.slice(0, 25)`s into `topActionable`, and
  // this panel took 12 of those — measured across five bundled companies,
  // `topActionable` was 25 every time while `actionableCount` ran 49 (Infosys) to
  // 211 (Reliance). So twelve rows stood for 211, and reporting
  // `topActionable.length` would have under-reported it too. The header counts
  // against `actionableCount`, the only number on hand that is not itself a
  // window.
  const backlog = capped(mappingAudit.backlogSummary.topActionable, BACKLOG_SHOWN);
  // Summed from the four tiles rather than read from `outOfSpecLabels.length`.
  // The two are equal today — `summarizeMappingBacklog` buckets every entry it
  // is given — but a caption sourced elsewhere can disagree with the tiles under
  // it, which is the defect this strip already had once.
  const backlogTotal = ACTION_ORDER.reduce(
    (sum, action) => sum + mappingAudit.backlogSummary.totalsByAction[action],
    0,
  );
  // Sorted here, not trusted from the producer. `assessAnalysisScope` sorts by
  // `periodsObserved` on six of its return paths but NOT on the explicit
  // `company_type` path, which returns `overrideSignals` in detection order —
  // and that is the path the library picker always takes, since it always
  // supplies a concrete type. So the head was "whichever SIGNAL_GROUPS key
  // matched first" on exactly the runs a reviewer sees most.
  const scopeSignals = capped(
    [...(qualityGate?.scopeAssessment.signals ?? [])].sort(
      (left, right) => right.periodsObserved - left.periodsObserved,
    ),
    SCOPE_SIGNALS_SHOWN,
  );

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
          <div className="font-semibold mb-1">
            Scope signals ({qualityGate.scopeAssessment.signals.length}) · strongest first
          </div>
          <div>{scopeSignals.shown.map((signal) => `${signal.kind}: ${signal.key}`).join(" · ")}</div>
          {scopeSignals.hidden > 0 && (
            <div className="mt-1">
              +{scopeSignals.hidden} weaker {scopeSignals.hidden === 1 ? "signal" : "signals"} not shown.
            </div>
          )}
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <StatBox label="BS keys in dataset" value={mappingAudit.datasetKeyCounts.BalanceSheet} />
        <StatBox label="PL keys in dataset" value={mappingAudit.datasetKeyCounts.ProfitLoss} />
        <StatBox label="CF keys in dataset" value={mappingAudit.datasetKeyCounts.CashFlow} />
        <StatBox label="Unknown keys" value={mappingAudit.datasetKeyCounts.Unknown} highlight={mappingAudit.datasetKeyCounts.Unknown > 0} />
      </div>

      {/* These five tiles were one `grid-cols-5` row of identical boxes, but
          they are not five categories. `totalsByAction` counts one bucket per
          entry, so the four action tiles partition the backlog exactly;
          `actionableCount` is `action !== "ignore-non-core"`
          (mappingBacklogPolicy.ts:463), so the fifth tile is the sum of the
          first three. Summing the row as displayed double-counted every
          actionable label — 2×actionable + ignored instead of the backlog size,
          a ~211-label overstatement on Reliance. The subtotal now sits in its
          own row, saying which tiles it re-counts. */}
      <div className="mb-4 space-y-2">
        <div className="text-xs text-slate-500">
          Out-of-spec labels by triage action · {backlogTotal.toLocaleString()} total
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {ACTION_ORDER.map((action) => (
            <StatBox
              key={action}
              label={ACTION_LABELS[action]}
              value={mappingAudit.backlogSummary.totalsByAction[action]}
              highlight={HIGHLIGHT_ACTIONS.has(action) && mappingAudit.backlogSummary.totalsByAction[action] > 0}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <StatBox
            label="Actionable subtotal"
            value={mappingAudit.backlogSummary.actionableCount}
            highlight={mappingAudit.backlogSummary.actionableCount > 0}
          />
          <div className="md:col-span-3 flex items-center text-xs text-slate-500">
            Not a fifth category — every label above except Ignored, counted again.
          </div>
        </div>
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
            <div className="text-slate-500">
              Showing {backlog.shown.length} of {mappingAudit.backlogSummary.actionableCount} actionable · highest-ranked first
            </div>
            {backlog.shown.map((entry) => (
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
              /* Cap dropped rather than given a remainder line: it could not
                 bind. This list is a subset of the YAML key universe, and the
                 whole spec file yields 182 extractable keys, so `.slice(0, 200)`
                 was dead code. Measured 60-119 across five bundled companies.
                 The container already scrolls. */
              mappingAudit.yamlKeysNotInDataset.map((k) => <div key={k}>{k}</div>)
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
