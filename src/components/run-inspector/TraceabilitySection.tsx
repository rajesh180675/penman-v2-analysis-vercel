import { InspectorPayload } from "./types";

type Traceability = NonNullable<NonNullable<InspectorPayload["latestAnalysisSnapshot"]>["traceability"]>;

interface TraceabilitySectionProps {
  traceability: Traceability | null;
  family: string | null | undefined;
  loading: boolean;
}

export function TraceabilitySection({ traceability, family, loading }: TraceabilitySectionProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-semibold text-slate-800">Traceability</h3>
      {traceability ? (
        <div className="mt-3 space-y-4 text-sm text-slate-700">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Schema: <strong>{traceability.schemaVersion ?? "—"}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Generated: <strong>{traceability.generatedAt ? new Date(traceability.generatedAt).toLocaleString("en-IN") : "—"}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Source mode: <strong>{traceability.runContext?.sourceMode ?? "—"}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Analysis family: <strong>{family ?? "—"}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Confidence: <strong>{traceability.confidence?.status ?? "—"}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Parser fidelity: <strong>{traceability.parserFidelity?.status ?? "—"}</strong>
              {typeof traceability.parserFidelity?.score === "number" ? ` (${traceability.parserFidelity.score}/100)` : ""}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Reconciliation: <strong>{traceability.reconciliation?.status ?? "—"}</strong>
              {typeof traceability.reconciliation?.maxResidualRatio === "number"
                ? ` (${(traceability.reconciliation.maxResidualRatio * 100).toFixed(2)}%)`
                : ""}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Concept identity: <strong>{traceability.conceptIdentity?.status ?? "—"}</strong>
              {typeof traceability.conceptIdentity?.conflictCount === "number" && traceability.conceptIdentity.conflictCount > 0
                ? ` (${traceability.conceptIdentity.conflictCount} conflict${traceability.conceptIdentity.conflictCount === 1 ? "" : "s"}, ${traceability.conceptIdentity.unresolvedCriticalCount ?? 0} critical)`
                : ""}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Economic sanity: <strong>{traceability.economicSanity?.status ?? "—"}</strong>
              {traceability.economicSanity?.anchorPeriod
                ? ` (anchor ${traceability.economicSanity.anchorPeriod})`
                : ""}
              {Array.isArray(traceability.economicSanity?.skippedPeriods) && (traceability.economicSanity?.skippedPeriods?.length ?? 0) > 0
                ? `, skipped ${traceability.economicSanity?.skippedPeriods?.length}`
                : ""}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Unusual items: <strong>{traceability.unusualItemManifest?.classifications?.length ?? 0}</strong>
              {traceability.unusualItemManifest?.terminalEligibilityBlocked
                ? ", terminal-blocked"
                : ""}
              {(traceability.unusualItemManifest?.unclassifiedCount ?? 0) > 0
                ? `, ${traceability.unusualItemManifest?.unclassifiedCount} unclassified`
                : ""}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Lineage: <strong>{traceability.lineageRef?.hasLineage ? "available" : "—"}</strong>
              {traceability.lineageRef?.hasLineage
                ? ` (${traceability.lineageRef?.conceptCount ?? 0} concepts × ${traceability.lineageRef?.periodCount ?? 0} periods, checksum ${traceability.lineageRef?.checksum?.slice(0, 8) ?? ""})`
                : ""}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Rigor level: <strong>{traceability.rigor?.currentLabel ?? "—"}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Raw/Recast periods: <strong>{traceability.analysisContext?.rawPeriodCount ?? 0} / {traceability.analysisContext?.recastPeriodCount ?? 0}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Debug files / keys: <strong>{traceability.analysisContext?.debugFiles ?? 0} / {traceability.analysisContext?.rawMetricKeyCount ?? 0}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Out-of-spec / actionable: <strong>{traceability.mappingCoverage?.outOfSpecLabelCount ?? 0} / {traceability.mappingCoverage?.actionableOutOfSpecLabelCount ?? 0}</strong>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Review backlog: <strong>{traceability.mappingCoverage?.backlogByAction?.review ?? 0}</strong>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 px-3 py-3">
            <div className="font-medium text-slate-800">{traceability.confidence?.headline ?? "Traceability confidence"}</div>
            <div className="mt-1 text-xs text-slate-500">
              Blocking {traceability.confidence?.blockingCount ?? 0} · Diagnostic {traceability.confidence?.diagnosticCount ?? 0} · Optional {traceability.confidence?.optionalCount ?? 0}
            </div>
            {traceability.rigor?.summary && (
              <div className="mt-2 text-xs text-slate-600">
                {traceability.rigor.summary}
              </div>
            )}
            {traceability.parserFidelity?.summary && (
              <div className="mt-2 text-xs text-slate-600">
                {traceability.parserFidelity.summary}
              </div>
            )}
            {traceability.reconciliation?.summary && (
              <div className="mt-2 text-xs text-slate-600">
                {traceability.reconciliation.summary}
              </div>
            )}
            {traceability.analysisContext?.engineError && (
              <div className="mt-2 text-xs text-red-700">Engine error: {traceability.analysisContext.engineError}</div>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 px-3 py-3">
            <div className="font-medium text-slate-800">Rigor ladder</div>
            <div className="mt-1 text-xs text-slate-500">
              Achieved {traceability.rigor?.achievedLevels?.join(" -> ") || "—"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Remaining {traceability.rigor?.pendingLevels?.join(" -> ") || "none"}
            </div>
          </div>
          <div>
            <div className="mb-2 font-medium text-slate-800">Backlog preview</div>
            {traceability.backlogPreview?.length ? (
              <div className="space-y-2">
                {traceability.backlogPreview.map((entry) => (
                  <div key={`${entry.statement}:${entry.key}`} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="font-medium text-slate-800">{entry.key}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {entry.statement} · {entry.action} · {entry.priority} · periods {entry.periodsObserved} · latest {entry.latestValue ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500">No backlog preview for this run.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{loading ? "Loading traceability…" : "No traceability payload found yet."}</p>
      )}
    </section>
  );
}
