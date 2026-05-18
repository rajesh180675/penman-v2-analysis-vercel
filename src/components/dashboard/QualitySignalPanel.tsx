import type { AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import type { SanityAssessment } from "../../engine/ratioSanity";
import type { SegmentData } from "../../engine/segmentParser";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";

interface Props {
  traceability?: AnalysisTraceabilityEnvelope | null;
  ratioSanity?: SanityAssessment | null;
  segmentData?: SegmentData | null;
  marketData?: LiveMarketDataSnapshot | null;
}

interface SignalRow {
  label: string;
  status: "pass" | "warning" | "fail" | "info" | "unavailable";
  detail?: string;
}

function StatusDot({ status }: { status: SignalRow["status"] }) {
  const colors = {
    pass: "bg-emerald-500",
    warning: "bg-amber-500",
    fail: "bg-red-500",
    info: "bg-blue-500",
    unavailable: "bg-slate-300 dark:bg-slate-600",
  };
  return <div className={`w-2.5 h-2.5 rounded-full ${colors[status]} flex-shrink-0`} />;
}

export default function QualitySignalPanel({ traceability, ratioSanity, segmentData, marketData }: Props) {
  const signals: SignalRow[] = [];

  // Reconciliation
  const reconStatus = traceability?.reconciliation?.status;
  signals.push({
    label: "BS Reconciliation",
    status: reconStatus === "confirmed" ? "pass" : reconStatus === "degraded" ? "warning" : reconStatus === "failed" ? "fail" : "unavailable",
    detail: reconStatus === "confirmed" ? "TA = Equity + Liabilities ✓" : reconStatus ? `Max residual: ${((traceability?.reconciliation?.maxResidualRatio ?? 0) * 100).toFixed(2)}%` : undefined,
  });

  // Parser fidelity
  const score = traceability?.parserFidelity?.score;
  signals.push({
    label: "Parser Fidelity",
    status: score != null ? (score >= 95 ? "pass" : score >= 80 ? "warning" : "fail") : "unavailable",
    detail: score != null ? `Score: ${score.toFixed(0)}/100` : undefined,
  });

  // Ratio sanity
  const sanityStatus = ratioSanity?.status;
  const failCount = ratioSanity?.checks?.filter(c => c.status === "fail").length ?? 0;
  const warnCount = ratioSanity?.checks?.filter(c => c.status === "warning").length ?? 0;
  signals.push({
    label: "Ratio Sanity",
    status: sanityStatus === "ok" ? "pass" : sanityStatus === "warning" ? "warning" : sanityStatus === "fail" ? "fail" : "unavailable",
    detail: sanityStatus === "ok" ? "All ratios within anchor bands" : `${failCount} fail, ${warnCount} warning`,
  });

  // Segment data
  signals.push({
    label: "Segment Data",
    status: segmentData && segmentData.segments.length >= 2 ? "pass" : "unavailable",
    detail: segmentData ? `${segmentData.segments.length} segments (${segmentData.segmentationType})` : "Not available in ZIP",
  });

  // Market data
  const hasMktData = marketData?.price != null;
  signals.push({
    label: "Market Data",
    status: hasMktData ? "pass" : "unavailable",
    detail: hasMktData ? `₹${marketData!.price!.toLocaleString("en-IN")} (${marketData!.freshness ?? "manual"})` : "Manual or not configured",
  });

  // Confidence
  const confidence = traceability?.confidence?.status;
  signals.push({
    label: "Overall Confidence",
    status: confidence === "production-ready" ? "pass" : confidence === "guarded" ? "warning" : confidence === "blocked" ? "fail" : "unavailable",
    detail: confidence ?? "Not computed",
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Quality Signals</h3>
      <div className="space-y-3">
        {signals.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <StatusDot status={s.status} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{s.label}</div>
              {s.detail && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{s.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
