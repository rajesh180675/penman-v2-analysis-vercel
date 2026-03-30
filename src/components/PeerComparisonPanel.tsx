import { PeerValuationSnapshot } from "../engine/peerValuation";

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

interface Props {
  snapshot: PeerValuationSnapshot;
}

export default function PeerComparisonPanel({ snapshot }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">Peer Snapshot</h3>
          <p className="mt-1 text-sm text-slate-500">A valuation conclusion is more useful when the investor can see it against peer opportunity and expected-return context.</p>
        </div>
        <div className="text-xs text-slate-500">{snapshot.peers.length} peers</div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Company</th>
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Signal</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">Stress CAGR</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">Stress value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {snapshot.peers.map((peer) => (
              <tr key={peer.companyId}>
                <td className="px-3 py-2 text-slate-800">{peer.label}</td>
                <td className="px-3 py-2 text-slate-700">{peer.signalLabel ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{pct(peer.expectedCagrStress)}</td>
                <td className="px-3 py-2 text-right font-mono">{peer.intrinsicPerShare != null ? `₹${peer.intrinsicPerShare.toFixed(2)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
