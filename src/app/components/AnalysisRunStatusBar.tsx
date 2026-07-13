import type { AnalysisRunExecutionState, AnalysisRunV1 } from "../../engine/analysisRun";

export function AnalysisRunStatusBar(props: {
  readonly run: AnalysisRunV1 | null;
  readonly executionState: AnalysisRunExecutionState | "idle";
}) {
  const { run, executionState } = props;
  if (!run) return null;

  const terminalFailure = executionState === "failed" || executionState === "blocked" || executionState === "cancelled";
  const hash = run.reproducibilityHash;
  const compactHash = `${hash.slice(0, 17)}…${hash.slice(-10)}`;

  return (
    <section
      aria-label="Immutable analysis run identity"
      data-run-id={run.runId}
      data-reproducibility-hash={hash}
      data-analysis-window-hash={run.analysisWindowRef?.contentHash ?? ""}
      data-market-snapshot-hash={run.marketSnapshotRef?.contentHash ?? ""}
      className={`mb-5 rounded-xl border px-4 py-3 ${
        terminalFailure
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60"
      }`}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Immutable analysis run
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700 dark:text-slate-200">
            <span>Status <b>{executionState}</b></span>
            <span>Run <b className="font-mono">{run.runId}</b></span>
            <span>Window <b>{run.analysisWindowRef ? "locked" : "unavailable"}</b></span>
            <span>Models <b>{run.modelResultRefs.length}</b></span>
          </div>
        </div>
        <div className="min-w-0 text-left lg:text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Reproducibility hash
          </div>
          <code className="block break-all text-[11px] text-slate-700 dark:text-slate-200" title={hash}>
            {compactHash}
          </code>
        </div>
      </div>
    </section>
  );
}
