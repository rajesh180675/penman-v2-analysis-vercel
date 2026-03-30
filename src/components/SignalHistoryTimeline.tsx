import { WorkspaceSignalHistoryEntry } from "../lib/researchWorkspace";

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function tone(state: string) {
  if (state === "screaming-buy") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (state === "high-conviction") return "border-green-200 bg-green-50 text-green-800";
  if (state === "interesting") return "border-blue-200 bg-blue-50 text-blue-800";
  if (state === "guarded") return "border-amber-200 bg-amber-50 text-amber-800";
  if (state === "blocked") return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

interface Props {
  signals: WorkspaceSignalHistoryEntry[];
}

export default function SignalHistoryTimeline({ signals }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">Signal Timeline</h3>
          <p className="mt-1 text-sm text-slate-500">This shows how the recommendation evolved over time, which matters more than any single snapshot.</p>
        </div>
        <div className="text-xs text-slate-500">{signals.length} saved states</div>
      </div>
      <div className="mt-4 space-y-3">
        {signals.slice(0, 12).map((signal) => (
          <div key={signal.id} className={`rounded-xl border p-4 ${tone(signal.state)}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-semibold">{signal.label}</div>
              <div className="text-xs">{new Date(signal.recordedAt).toLocaleString("en-IN")}</div>
            </div>
            <div className="mt-2 text-sm">{signal.summary}</div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
              <div>Confidence: <strong>{signal.confidenceState}</strong></div>
              <div>Stress CAGR: <strong>{pct(signal.expectedCagrStress)}</strong></div>
              <div>Opportunity: <strong>{signal.opportunityScore != null ? `${signal.opportunityScore.toFixed(0)}/100` : "—"}</strong></div>
              <div>Market price: <strong>{signal.marketPrice != null ? `₹${signal.marketPrice.toFixed(2)}` : "—"}</strong></div>
            </div>
          </div>
        ))}
        {!signals.length && (
          <p className="text-sm text-slate-500">No signal history exists yet. Open the valuation tab and let the app persist a valuation signal first.</p>
        )}
      </div>
    </div>
  );
}
