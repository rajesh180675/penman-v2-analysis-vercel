/* ── Relative Valuation ───────────────────────────────────────── */
import { RelativeValuationResult, MultipleBand } from "../../engine/relativeValuation";
import { pct, cr } from "./v3Formatters";
import { MetricCard, NullState } from "./SharedUI";

export function RelativeValSection({ rv }: { rv: RelativeValuationResult | null }) {
  if (!rv) return <NullState message="Relative valuation requires market_price and shares_outstanding in config." />;

  const SIGNAL_COLORS: Record<string, string> = {
    cheap: "text-emerald-700 bg-emerald-50",
    fair: "text-blue-700 bg-blue-50",
    expensive: "text-red-700 bg-red-50",
    unknown: "text-slate-500 bg-slate-50",
  };

  function bandSignal(band: MultipleBand): string {
    if (band.currentPercentile == null) return "unknown";
    if (band.currentPercentile <= 25) return "cheap";
    if (band.currentPercentile >= 75) return "expensive";
    return "fair";
  }

  function BandRow({ band }: { band: MultipleBand }) {
    const signal = bandSignal(band);
    return (
      <div className="bg-slate-50 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-700">{band.metric}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${SIGNAL_COLORS[signal]}`}>{signal.toUpperCase()}</span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs text-center">
          <div><p className="text-slate-400">Min</p><p className="font-medium text-slate-700">{band.min != null ? band.min.toFixed(1) : "—"}×</p></div>
          <div><p className="text-slate-400">Median</p><p className="font-medium text-slate-700">{band.median != null ? band.median.toFixed(1) : "—"}×</p></div>
          <div><p className="text-slate-400">Current</p><p className="font-bold text-slate-800">{band.current != null ? band.current.toFixed(1) : "—"}×</p></div>
          <div><p className="text-slate-400">Max</p><p className="font-medium text-slate-700">{band.max != null ? band.max.toFixed(1) : "—"}×</p></div>
        </div>
        {band.currentPercentile != null && (
          <div className="mt-2">
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-blue-400" style={{ width: `${band.currentPercentile}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{band.currentPercentile}th percentile of history</p>
          </div>
        )}
        {band.sectorMedian != null && (
          <p className="text-xs text-slate-500 mt-1">
            Sector median: {band.sectorMedian.toFixed(1)}×
            {band.premiumToSector != null && ` (${band.premiumToSector > 0 ? "+" : ""}${pct(band.premiumToSector)} vs sector)`}
          </p>
        )}
        {band.impliedFairValue != null && (
          <p className="text-xs text-slate-500">Implied fair value: {cr(band.impliedFairValue)}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Relative Valuation</h3>
        <p className="text-xs text-slate-500">Historical multiple bands + sector comparison. Current multiple vs own history and sector peers.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Company Type"
          value={rv.companyType.toUpperCase()}
          badge="Metric selection basis"
          color="text-slate-700 bg-slate-50"
        />
        {rv.impliedFairValueComposite != null && (
          <MetricCard
            label="Composite Implied Value"
            value={cr(rv.impliedFairValueComposite)}
            badge={rv.marginOfSafety != null ? `MoS: ${pct(rv.marginOfSafety)}` : "No market price"}
            color={rv.marginOfSafety != null && rv.marginOfSafety > 0 ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}
          />
        )}
      </div>

      {rv.primary.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Primary Multiples</p>
          <div className="space-y-2">
            {rv.primary.map((b: MultipleBand) => <BandRow key={b.metric} band={b} />)}
          </div>
        </div>
      )}

      {rv.secondary.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Secondary Multiples</p>
          <div className="space-y-2">
            {rv.secondary.map((b: MultipleBand) => <BandRow key={b.metric} band={b} />)}
          </div>
        </div>
      )}

      {rv.notes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          {rv.notes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
        </div>
      )}
    </div>
  );
}
