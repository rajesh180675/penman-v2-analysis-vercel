export function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="text-lg font-bold text-slate-800 mt-1">{value}</div>
    </div>
  );
}

export function MiniBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="font-semibold text-slate-800 mt-1">{value}</div>
    </div>
  );
}

export function Row({ metric, latest, avg5, bm, note }: { metric: string; latest: string; avg5: string; bm: string; note: string }) {
  return (
    <tr>
      <td className="px-3 py-2 font-medium text-slate-700">{metric}</td>
      <td className="px-3 py-2 text-right font-mono">{latest}</td>
      <td className="px-3 py-2 text-right font-mono">{avg5}</td>
      <td className="px-3 py-2 text-right font-mono text-slate-500">{bm}</td>
      <td className="px-3 py-2 text-slate-600 text-xs">{note}</td>
    </tr>
  );
}
