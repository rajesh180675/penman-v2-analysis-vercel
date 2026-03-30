import { ReverseDcfDiagnostics } from "../engine/valuationCommandCenter";

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

interface Props {
  reverseDcf: ReverseDcfDiagnostics;
}

export default function ExpectationBridgePanel({ reverseDcf }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expectation Bridge</div>
      <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Implied growth</div>
          <div className="mt-1 font-semibold text-slate-900">{pct(reverseDcf.impliedOwnerEarningsGrowth, 2)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Normalized anchor</div>
          <div className="mt-1 font-semibold text-slate-900">{pct(reverseDcf.normalizedGrowthAnchor, 2)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Spread</div>
          <div className="mt-1 font-semibold text-slate-900">{pct(reverseDcf.spreadVsNormalizedGrowth, 2)}</div>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
        {reverseDcf.expectationLabel}
      </div>
    </div>
  );
}
