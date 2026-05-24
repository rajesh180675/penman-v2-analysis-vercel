import type { SegmentRNOADecomposition } from '../../engine/segmentRNOAEngine';
import type { CapitalAllocationResult } from '../../engine/capitalAllocationEngine';
import type { ConglomerateDiscountResult } from '../../engine/capitalAllocationEngine';

interface Props {
  segmentRNOA: SegmentRNOADecomposition | null;
  capitalAllocation: CapitalAllocationResult | null;
  conglomerateDiscount: ConglomerateDiscountResult | null;
}

const quadrantEmoji = { star: '⭐', margin_fortress: '🏰', volume_play: '🏃', dog: '🐕' } as const;
const lifecycleColor = { growth: 'text-green-400', mature: 'text-blue-400', startup: 'text-cyan-400', decline: 'text-red-400' } as const;
const trendDisplay = { improving: { arrow: '↑', color: 'text-green-400' }, stable: { arrow: '→', color: 'text-gray-400' }, deteriorating: { arrow: '↓', color: 'text-red-400' } } as const;

export default function AdvancedSegmentPanel({ segmentRNOA, capitalAllocation, conglomerateDiscount }: Props) {
  if (!segmentRNOA && !capitalAllocation && !conglomerateDiscount) return null;

  const efficiencyScore = capitalAllocation?.firmLevel.capitalEfficiencyScore;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Segment Intelligence</h3>
        {efficiencyScore != null && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            efficiencyScore >= 75 ? 'bg-green-900/50 text-green-300' :
            efficiencyScore >= 50 ? 'bg-yellow-900/50 text-yellow-300' :
            'bg-red-900/50 text-red-300'
          }`}>
            Efficiency: {efficiencyScore}
          </span>
        )}
      </div>

      {segmentRNOA && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-slate-600 dark:text-slate-300">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                <th className="text-left py-1 pr-2">Segment</th>
                <th className="text-right px-1">OPM%</th>
                <th className="text-right px-1">ATO</th>
                <th className="text-right px-1">RNOA%</th>
                <th className="text-center px-1">Type</th>
                <th className="text-center px-1">Stage</th>
                <th className="text-center px-1">Trend</th>
              </tr>
            </thead>
            <tbody>
              {segmentRNOA.segments.map((seg) => (
                <tr key={seg.name} className="border-b border-slate-800">
                  <td className="py-1 pr-2 font-medium truncate max-w-[100px]">{seg.name}</td>
                  <td className="text-right px-1">{(seg.opm * 100).toFixed(1)}</td>
                  <td className="text-right px-1">{seg.ato.toFixed(2)}</td>
                  <td className="text-right px-1">{(seg.rnoa * 100).toFixed(1)}</td>
                  <td className="text-center px-1">{quadrantEmoji[seg.quadrant]}</td>
                  <td className={`text-center px-1 ${lifecycleColor[seg.lifecycle]}`}>{seg.lifecycle}</td>
                  <td className={`text-center px-1 ${trendDisplay[seg.trend].color}`}>{trendDisplay[seg.trend].arrow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {capitalAllocation && (
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Allocation Quality:</span>
            <span className={`font-medium ${
              capitalAllocation.firmLevel.allocationQuality === 'excellent' ? 'text-green-400' :
              capitalAllocation.firmLevel.allocationQuality === 'good' ? 'text-blue-400' :
              capitalAllocation.firmLevel.allocationQuality === 'poor' ? 'text-yellow-400' :
              'text-red-400'
            }`}>
              {capitalAllocation.firmLevel.allocationQuality.replace('_', ' ')}
            </span>
          </div>
          {capitalAllocation.segments.filter(s => s.verdict === 'divest').length > 0 && (
            <p className="text-red-300/80">
              ⚠ Divest candidates: {capitalAllocation.segments.filter(s => s.verdict === 'divest').map(s => s.name).join(', ')}
            </p>
          )}
        </div>
      )}

      {conglomerateDiscount && (
        <div className="text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Conglomerate Discount</span>
            <span className={`font-bold ${
              conglomerateDiscount.verdict === 'premium' ? 'text-green-400' :
              conglomerateDiscount.verdict === 'fair' ? 'text-slate-600 dark:text-slate-300' :
              conglomerateDiscount.verdict === 'discount' ? 'text-yellow-400' :
              'text-red-400'
            }`}>
              {conglomerateDiscount.discountPct > 0 ? '-' : '+'}{Math.abs(conglomerateDiscount.discountPct).toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${conglomerateDiscount.discountPct > 15 ? 'bg-red-500' : conglomerateDiscount.discountPct > 0 ? 'bg-yellow-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(100, Math.max(5, 50 + conglomerateDiscount.discountPct))}%` }}
            />
          </div>
          <p className="text-slate-500 dark:text-slate-400 italic">{conglomerateDiscount.narrative}</p>
        </div>
      )}

      {segmentRNOA?.valueCreation && (
        <div className="flex gap-3 text-xs pt-1 border-t border-slate-800">
          <span className="text-green-400">
            {segmentRNOA.valueCreation.valueCreatingSegments.length} creating value
          </span>
          <span className="text-red-400">
            {segmentRNOA.valueCreation.valueDestroyingSegments.length} destroying value
          </span>
          <span className="text-slate-500 dark:text-slate-400 ml-auto">
            Net: {segmentRNOA.valueCreation.netEconomicProfit >= 0 ? '+' : ''}{segmentRNOA.valueCreation.netEconomicProfit.toFixed(0)}M
          </span>
        </div>
      )}
    </div>
  );
}
