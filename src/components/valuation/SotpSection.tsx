import { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import { StatTile } from "./atoms";

export default function SotpSection({
  commandCenter,
}: {
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
}) {
  if (!commandCenter.sotp) return null;
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">SOTP Valuation</div>
        {commandCenter.conglomerate?.sotpPreferred && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            This is a diversified conglomerate ({commandCenter.conglomerate.segmentCount} segments across {commandCenter.conglomerate.distinctSectorTemplates} sector templates). SOTP is the preferred valuation anchor — single-entity V_RE is less meaningful when business lines have structurally different economics.
          </div>
        )}
        <div className="mt-2 text-sm text-slate-600">Sum-of-the-parts decomposes a conglomerate into separately valued business lines. The conglomerate discount reflects the diversification penalty the market typically applies to multi-segment firms.</div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-2 py-1.5 text-left text-slate-500 font-medium">Segment</th>
                <th className="px-2 py-1.5 text-right text-slate-500 font-medium">Op. Profit (₹ Cr)</th>
                <th className="px-2 py-1.5 text-right text-slate-500 font-medium">Value (₹ Cr)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {commandCenter.sotp.segments.map((seg) => (
                <tr key={seg.name} className="hover:bg-slate-50">
                  <td className="px-2 py-1.5 font-medium text-slate-700">{seg.name}</td>
                  <td className="px-2 py-1.5 text-right font-mono">₹{Math.round(seg.operatingProfit).toLocaleString('en-IN')}</td>
                  <td className="px-2 py-1.5 text-right font-mono">₹{Math.round(seg.segmentValue).toLocaleString('en-IN')}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-indigo-50">
                <td className="px-2 py-1.5 text-indigo-700">Operating sum</td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right font-mono text-indigo-800">₹{Math.round(commandCenter.sotp.operatingSum).toLocaleString('en-IN')}</td>
              </tr>
              <tr className="font-semibold bg-indigo-50">
                <td className="px-2 py-1.5 text-indigo-700">Total enterprise value</td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right font-mono text-indigo-800">₹{Math.round(commandCenter.sotp.totalEnterpriseValue).toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-slate-600">
          <div>Conglomerate discount: <strong className={commandCenter.sotp.conglomerateDiscountPct > 0.05 ? "text-amber-700" : ""}>{(commandCenter.sotp.conglomerateDiscountPct * 100).toFixed(1)}%</strong></div>
          <div>After-discount value: <strong>₹{Math.round(commandCenter.sotp.discountedSum).toLocaleString('en-IN')}</strong></div>
          {commandCenter.sotp.explanation.length > 0 && (
            <div className="mt-2 text-xs text-slate-500 italic">{commandCenter.sotp.explanation[0]}</div>
          )}
        </div>
      </div>

      {/* ── EV/EBITDA Cross-Check ──────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">EV/EBITDA Cross-Check</div>
        <div className="mt-2 text-sm text-slate-600">Peer-median EV/EBITDA provides an independent sanity check on DCF outputs. The market-derived multiple (if available) is compared against the peer distribution.</div>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <StatTile label="Company EV/EBITDA" value={commandCenter.evEbitda.evEbitdaCompany != null ? `${commandCenter.evEbitda.evEbitdaCompany.toFixed(1)}x` : "—"} />
          <StatTile label="Peer median EV/EBITDA" value={commandCenter.evEbitda.evEbitdaMedian != null ? `${commandCenter.evEbitda.evEbitdaMedian.toFixed(1)}x` : "—"} />
          <StatTile label="Implied equity (median)" value={commandCenter.evEbitda.equityFromMedian != null ? `₹${Math.round(commandCenter.evEbitda.equityFromMedian).toLocaleString('en-IN')} Cr` : "—"} />
          <StatTile label="P25 / P75 range" value={commandCenter.evEbitda.evEbitdaP25 != null && commandCenter.evEbitda.evEbitdaP75 != null ? `${commandCenter.evEbitda.evEbitdaP25.toFixed(1)}x – ${commandCenter.evEbitda.evEbitdaP75.toFixed(1)}x` : "—"} />
          {/* Was `value={...evEbitda.label}` — a semicolon-joined summary that
              begins `EBITDA_T: <n>` and contains no count in any code path, so
              this tile showed the reviewer an EBITDA figure under the heading
              "Peer count". The engine now reports the post-filter count. */}
          <StatTile label="Peer count" value={`${commandCenter.evEbitda.peerCount}`} />
        </div>
        {/* Every tile above except the market-derived one goes blank when no peer
            multiple is configured, which reads as a broken panel rather than an
            absent input. `config.ev_ebitda_peers` is the only source and nothing
            in the app writes it, so say so instead of showing a row of dashes. */}
        {commandCenter.evEbitda.peerCount === 0 && (
          <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
            No peer multiples are configured, so there is no peer distribution to check the DCF against. The relative model reports itself as not computed rather than contributing a value to the triangulation.
          </div>
        )}
      </div>
    </section>
  );
}
