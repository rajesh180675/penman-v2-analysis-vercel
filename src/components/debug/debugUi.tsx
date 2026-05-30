/* ── Shared presentational primitives for DebugPanel ───────────────
   Extracted verbatim from DebugPanel.tsx. No logic changes. */

export function IdentityRow({
  label, lhs, rhs, ok, diff,
}: {
  label: string; lhs: string; rhs: string; ok: boolean; diff: number;
}) {
  return (
    <div className={`flex flex-wrap items-start gap-x-2 gap-y-0.5 ${ok ? "text-green-300" : "text-red-300"}`}>
      <span className="text-slate-400 w-40 shrink-0 text-xs">{label}:</span>
      <span className="text-xs">{lhs}</span>
      <span className="text-slate-500">=</span>
      <span className="text-xs">{rhs}</span>
      <span className={`ml-auto font-bold text-xs ${ok ? "text-green-400" : "text-red-400"}`}>
        {ok ? "✓" : `⚠ diff=${diff.toFixed(1)}`}
      </span>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
        <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatBox({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-xl border ${highlight ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
      <div className={`text-2xl font-bold ${highlight ? "text-amber-700" : "text-slate-800"}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}
