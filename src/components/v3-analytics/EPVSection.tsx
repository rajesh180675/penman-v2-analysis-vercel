/* ── EPV (Graham-Dodd) ────────────────────────────────────────── */
import { EPVResult } from "../../engine/grahamDoddEPV";
import { pct, cr } from "./v3Formatters";
import { MetricCard, InfoBlock, InfoRow, NullState } from "./SharedUI";

export function EPVSection({ epv }: { epv: EPVResult | null }) {
  if (!epv) return <NullState message="EPV requires ≥ 3 periods and market price + shares outstanding in config." />;

  const INTERP_COLORS: Record<string, string> = {
    "strong-franchise": "text-emerald-700 bg-emerald-50 border-emerald-200",
    "franchise": "text-blue-700 bg-blue-50 border-blue-200",
    "competitive": "text-amber-700 bg-amber-50 border-amber-200",
    "depressed-earnings": "text-orange-700 bg-orange-50 border-orange-200",
    "insufficient-data": "text-slate-500 bg-slate-50 border-slate-200",
  };
  const CONF_COLOR: Record<string, string> = {
    high: "text-emerald-700 bg-emerald-50",
    medium: "text-amber-700 bg-amber-50",
    low: "text-red-700 bg-red-50",
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Earnings Power Value (Graham-Dodd)</h3>
        <p className="text-xs text-slate-500">EPV = Normalized NOPAT / WACC. Franchise value = EPV − Asset value. A strong franchise earns above its reproduction cost.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="EPV (Enterprise)"
          value={cr(epv.V_EPV)}
          badge={epv.interpretation.replace(/-/g, " ")}
          color={INTERP_COLORS[epv.interpretation]!}
        />
        <MetricCard
          label="Asset Value (NOA)"
          value={cr(epv.V_A)}
          badge="Reproduction cost proxy"
          color="text-slate-700 bg-slate-50"
        />
        <MetricCard
          label="Franchise Value"
          value={cr(epv.franchiseValue)}
          badge={`${pct(epv.franchisePct)} of EPV`}
          color={epv.franchiseValue > 0 ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}
        />
        <MetricCard
          label="Confidence"
          value={epv.confidence.toUpperCase()}
          badge={`WACC: ${pct(epv.kw)}`}
          color={CONF_COLOR[epv.confidence]!}
        />
      </div>

      {(epv.epvPerShare != null || epv.marginOfSafety != null) && (
        <InfoBlock title="Per-Share & Market Comparison">
          {epv.epvPerShare != null && <InfoRow label="EPV per share" value={`₹${epv.epvPerShare.toFixed(1)}`} />}
          {epv.priceToEPV != null && <InfoRow label="Price / EPV" value={`${epv.priceToEPV.toFixed(2)}×`} />}
          {epv.marginOfSafety != null && <InfoRow label="Margin of safety" value={pct(epv.marginOfSafety)} />}
        </InfoBlock>
      )}

      <InfoBlock title="Normalization Details">
        <InfoRow label="Periods used" value={`${epv.normalization.periodsUsed}`} />
        <InfoRow label="Median CoreOI margin" value={pct(epv.normalization.medianCoreOIMargin)} />
        <InfoRow label="Normalized NOPAT" value={cr(epv.normalization.normalizedNOPAT)} />
        <InfoRow label="Median tax rate" value={pct(epv.normalization.medianTaxRate)} />
        <InfoRow label="Latest sales base" value={cr(epv.normalization.latestSales)} />
        <InfoRow label="Margin range" value={`${pct(epv.normalization.marginRange[0])} – ${pct(epv.normalization.marginRange[1])}`} />
        <InfoRow label="High confidence" value={epv.normalization.highConfidence ? "✓ Yes" : "⚠ No"} />
      </InfoBlock>

      {epv.confidenceNotes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          {epv.confidenceNotes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
        </div>
      )}
    </div>
  );
}
