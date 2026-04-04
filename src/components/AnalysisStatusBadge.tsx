import { AnalysisStatusSummary } from "../engine/analysisStatus";

function toneClasses(tone: AnalysisStatusSummary["tone"], compact: boolean) {
  if (tone === "red") {
    return compact
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-red-200 bg-red-50 text-red-900";
  }
  if (tone === "amber") {
    return compact
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-amber-200 bg-amber-50 text-amber-900";
  }
  return compact
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-900";
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

  return (
    <div className={`rounded-xl border p-4 ${classes}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex rounded-full border border-current/20 px-2.5 py-1 text-xs font-semibold">
          {status.label}
        </span>
        <span className="text-xs font-medium uppercase tracking-wide opacity-75">
          {status.headline}
        </span>
      </div>
      <p className="mt-2 text-sm font-medium">{status.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs opacity-80">
        <span>Blocking: {status.effectiveBlockingCount ?? status.blockingCount}</span>
        <span>Diagnostic: {status.effectiveDiagnosticCount ?? status.diagnosticCount}</span>
        <span>Optional: {status.effectiveOptionalCount ?? status.optionalCount}</span>
        <span>Valuation: {status.valuationStatus}</span>
      </div>
    </div>
  );
}
