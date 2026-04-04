import { WorkspacePortfolioPlan, WorkspaceValuationSnapshot } from "../lib/researchWorkspace";

interface Props {
  plan: WorkspacePortfolioPlan;
  latestValuation: WorkspaceValuationSnapshot | null;
  onChange: (patch: Partial<WorkspacePortfolioPlan>) => void;
}

function recommendedWeight(signalState: string | null | undefined) {
  if (signalState === "screaming-buy") return "rare dislocation; still size only within portfolio discipline";
  if (signalState === "high-conviction") return "candidate for core weight if thesis quality matches the signal";
  if (signalState === "interesting") return "usually a starter or accumulate zone, not a full-size position";
  if (signalState === "guarded" || signalState === "blocked") return "research-only until the confidence state improves";
  return "research-first; wait for a clearer edge";
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function TextField({ label, value, onChange }: FieldProps) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
    </div>
  );
}

export default function PortfolioAllocator({ plan, latestValuation, onChange }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-bold text-slate-800">Portfolio Allocator</h3>
      <p className="mt-1 text-sm text-slate-500">
        The tool should help you decide what to do next, not just what a spreadsheet says. Translate the signal into position discipline here.
      </p>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        Recommendation: <strong>{recommendedWeight(latestValuation?.signalState)}</strong>
        {latestValuation?.persistenceNarrative ? (
          <div className="mt-2 text-slate-600">Persistence lens: {latestValuation.persistenceNarrative}</div>
        ) : null}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Sizing bucket</label>
          <select
            value={plan.sizingBucket}
            onChange={(event) => onChange({ sizingBucket: event.target.value as WorkspacePortfolioPlan["sizingBucket"] })}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="research-only">Research only</option>
            <option value="starter">Starter</option>
            <option value="accumulate">Accumulate</option>
            <option value="core">Core</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </div>
        <TextField
          label="Target weight (%)"
          value={plan.targetWeightPct != null ? String(plan.targetWeightPct) : ""}
          onChange={(value) => onChange({ targetWeightPct: value ? Number(value) : null })}
        />
        <TextField
          label="Max weight (%)"
          value={plan.maxWeightPct != null ? String(plan.maxWeightPct) : ""}
          onChange={(value) => onChange({ maxWeightPct: value ? Number(value) : null })}
        />
        <TextField
          label="Current weight (%)"
          value={plan.currentWeightPct != null ? String(plan.currentWeightPct) : ""}
          onChange={(value) => onChange({ currentWeightPct: value ? Number(value) : null })}
        />
        <TextField label="Risk budget note" value={plan.riskBudgetNote} onChange={(value) => onChange({ riskBudgetNote: value })} />
        <TextField label="Thesis overlap" value={plan.thesisOverlap} onChange={(value) => onChange({ thesisOverlap: value })} />
      </div>
      <div className="mt-4">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Exit rule</label>
        <textarea
          value={plan.exitRule}
          onChange={(event) => onChange({ exitRule: event.target.value })}
          rows={3}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
