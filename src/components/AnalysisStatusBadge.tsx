import { AnalysisStatusSummary } from "../engine/analysisStatus";

function toneClasses(tone: AnalysisStatusSummary["tone"], compact: boolean) {
  if (tone === "red") {
    return compact
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300"
      : "trust-gate-blocked";
  }
  if (tone === "amber") {
    return compact
      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300"
      : "trust-gate-guarded";
  }
  return compact
    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300"
    : "trust-gate-production";
}

function toneIcon(tone: AnalysisStatusSummary["tone"]) {
  if (tone === "red") return { icon: "🚫", cls: "trust-gate-icon-blocked" };
  if (tone === "amber") return { icon: "⚠️", cls: "trust-gate-icon-guarded" };
  return { icon: "✓", cls: "trust-gate-icon-production" };
}

export function AnalysisStatusBadge({ status, compact = false }: { status: AnalysisStatusSummary; compact?: boolean }) {
  const classes = toneClasses(status.tone, compact);
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${classes}`}>
        <span>{status.label}</span>
        <span className="opacity-70">Tier {status.qualityTier.replace("Tier ", "")}</span>
      </span>
    );
  }

  const { icon, cls } = toneIcon(status.tone);

  return (
    <div className={classes}>
      <div className={cls}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold tracking-tight">
            {status.headline}
          </span>
          <span className="inline-flex rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
            {status.label}
          </span>
        </div>
        <p className="mt-1 text-sm opacity-90">{status.summary}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs opacity-70 font-medium">
          <span>Blocking: <strong>{status.effectiveBlockingCount ?? status.blockingCount}</strong></span>
          <span>Diagnostic: <strong>{status.effectiveDiagnosticCount ?? status.diagnosticCount}</strong></span>
          <span>Optional: <strong>{status.effectiveOptionalCount ?? status.optionalCount}</strong></span>
          <span>Valuation: <strong>{status.valuationStatus}</strong></span>
        </div>
      </div>
    </div>
  );
}
