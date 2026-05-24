import type { PenmanExpectedReturn } from '../../engine/penmanExpectedReturn';
import type { AccountingAnchorResult } from '../../engine/accountingAnchor';

interface Props {
  penmanReturn: PenmanExpectedReturn | null;
  accountingAnchor: AccountingAnchorResult | null;
}

const verdictColor = { attractive: 'text-green-400', fair: 'text-amber-400', expensive: 'text-red-400' };
const verdictBg = { attractive: 'bg-green-900/40 text-green-300', fair: 'bg-amber-900/40 text-amber-300', expensive: 'bg-red-900/40 text-red-300' };
const signalBg: Record<string, string> = {
  deep_value: 'bg-emerald-900/40 text-emerald-300',
  value: 'bg-green-900/40 text-green-300',
  fair: 'bg-slate-700 text-slate-600 dark:text-slate-300',
  growth_premium: 'bg-amber-900/40 text-amber-300',
  speculative: 'bg-red-900/40 text-red-300',
};

export default function PenmanExpectedReturnPanel({ penmanReturn, accountingAnchor }: Props) {
  if (!penmanReturn && !accountingAnchor) return null;

  const pr = penmanReturn;
  const aa = accountingAnchor;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      {/* Hero expected return */}
      {pr && (
        <div className="flex items-baseline gap-3">
          <span className={`text-3xl font-bold ${verdictColor[pr.verdict]}`}>
            {(pr.expectedReturn * 100).toFixed(1)}%
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${verdictBg[pr.verdict]}`}>
            {pr.verdict}
          </span>
          {aa && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${signalBg[aa.signal] ?? 'bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
              {aa.signal.replace('_', ' ')}
            </span>
          )}
          <span className="ml-auto text-xs text-slate-500">P/B {pr.pricePaid.toFixed(2)}</span>
        </div>
      )}

      {/* Valuation layers stacked bar */}
      {aa && (
        <div className="space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Valuation Layers (per share)</p>
          <div className="flex h-5 rounded overflow-hidden text-[10px] font-medium">
            {(() => {
              const max = Math.max(aa.marketPrice, aa.layers.totalIntrinsic);
              const pct = (v: number) => `${Math.max((v / max) * 100, 0).toFixed(1)}%`;
              return (
                <>
                  <div className="bg-blue-800 flex items-center justify-center" style={{ width: pct(aa.layers.assetValue) }}>Asset</div>
                  <div className="bg-indigo-700 flex items-center justify-center" style={{ width: pct(aa.layers.epv - aa.layers.assetValue) }}>EPV</div>
                  <div className="bg-purple-700 flex items-center justify-center" style={{ width: pct(aa.layers.growthValue) }}>Growth</div>
                </>
              );
            })()}
          </div>
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>Intrinsic ${aa.layers.totalIntrinsic.toFixed(0)}</span>
            <span>Market ${aa.marketPrice.toFixed(0)}</span>
          </div>
        </div>
      )}

      {/* Return decomposition */}
      {pr && (
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div><p className="text-slate-500 dark:text-slate-400">RNOA</p><p className="text-slate-800 dark:text-slate-200">{(pr.rnoaComponent * 100).toFixed(1)}%</p></div>
          <div><p className="text-slate-500 dark:text-slate-400">Persist.</p><p className="text-slate-800 dark:text-slate-200">{(pr.persistenceComponent * 100).toFixed(1)}%</p></div>
          <div><p className="text-slate-500 dark:text-slate-400">Growth</p><p className="text-slate-800 dark:text-slate-200">{(pr.growthComponent * 100).toFixed(1)}%</p></div>
          <div><p className="text-slate-500 dark:text-slate-400">Total</p><p className="font-semibold text-slate-800 dark:text-slate-100">{(pr.expectedReturn * 100).toFixed(1)}%</p></div>
        </div>
      )}

      {/* Required for hurdle */}
      {pr && (
        <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>Required for 15%: max P/B <span className="text-slate-800 dark:text-slate-200">{pr.requiredForHurdle.maxPB.toFixed(2)}</span></span>
          <span>min RNOA <span className="text-slate-800 dark:text-slate-200">{(pr.requiredForHurdle.minRNOA * 100).toFixed(1)}%</span></span>
        </div>
      )}

      {/* Growth justified */}
      {pr && (
        <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>EPV/sh ${pr.valuationLayers.epvPerShare.toFixed(1)}</span>
          <span>Growth premium {(pr.valuationLayers.growthPremiumPct * 100).toFixed(0)}%</span>
          <span>{pr.valuationLayers.growthJustified ? '✓ justified' : '✗ not justified'}</span>
        </div>
      )}

      {/* Narrative */}
      {pr?.narrative && (
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{pr.narrative}</p>
      )}
    </div>
  );
}
