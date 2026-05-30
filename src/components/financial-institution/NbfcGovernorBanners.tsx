import type {
  CreditCostCycleCheck,
  CrarGovernorResult,
  EclStressGovernorResult,
  SpreadCompressionCheck,
} from "../../engine/bankValuation";

/**
 * Phase D2 — Governor & cycle diagnostic banners (NBFC-only).
 *
 * Renders amber/rose advisory banners surfacing the CRAR-buffer growth
 * governor adjustment (when the model throttled g) and the through-cycle
 * credit-cost band check (when latest is well below or above trailing
 * 7y median, suggesting under-provisioning or stress-peak).
 */
export function NbfcGovernorBanners({
  crarGov,
  cycle,
  eclStressGov,
  spreadComp,
}: {
  crarGov: CrarGovernorResult | undefined;
  cycle: CreditCostCycleCheck | undefined;
  eclStressGov: EclStressGovernorResult | undefined;
  spreadComp: SpreadCompressionCheck | undefined;
}) {
  if (!crarGov && !cycle && !eclStressGov && !spreadComp) return null;
  const gShouldShow = crarGov && crarGov.status === "computed" &&
    crarGov.headroomBps != null && crarGov.headroomBps < 300;
  const cycleShouldShow = cycle && cycle.status === "computed" &&
    (cycle.severity === "under-provisioning" || cycle.severity === "stress-peak");
  if (!gShouldShow && !cycleShouldShow) return null;

  return (
    <div className="space-y-2">
      {gShouldShow && crarGov && (
        <div className={`rounded border p-3 text-sm ${
          (crarGov.headroomBps ?? 0) <= 0
            ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        }`}>
          <span className="font-semibold">CRAR-buffer governor active.</span>{" "}
          {crarGov.message}
        </div>
      )}
      {cycleShouldShow && cycle && (
        <div className={`rounded border p-3 text-sm ${
          cycle.severity === "stress-peak"
            ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        }`}>
          <span className="font-semibold">
            Credit cost {cycle.severity === "under-provisioning" ? "below trend" : "elevated"}.
          </span>{" "}
          {cycle.message}
        </div>
      )}

      {/* Phase D3 — ECL Stress Governor visual panel */}
      {eclStressGov && eclStressGov.status === "computed" && (
        <EclStressPanel ecl={eclStressGov} />
      )}

      {/* Phase D3b — Spread Compression / Cost-of-Funds Sensitivity */}
      {spreadComp && spreadComp.status === "computed" && (
        <SpreadCompressionPanel sc={spreadComp} />
      )}
    </div>
  );
}

/**
 * Phase D3 — ECL Stress Governor visual panel.
 *
 * Renders a compact stress gauge showing:
 *   - The uncovered stress % on a color-coded bar (green → amber → rose)
 *   - The fade factor applied to justified P/B
 *   - Stage 3, ECL coverage, restructured breakdown
 *   - Stage 2 watchlist advisory when elevated
 *
 * The gauge uses the same threshold bands as the governor:
 *   [0, 2%)   green  — healthy
 *   [2%, 5%)  amber  — warning
 *   [5%, 10%) rose   — distress
 *   [10%+]    red    — severe
 */
function EclStressPanel({ ecl }: { ecl: EclStressGovernorResult }) {
  const stress = ecl.uncoveredStressPct ?? 0;
  const factor = ecl.fadeFactor;

  // Color coding based on zone
  const zone = stress < 2 ? "healthy" : stress < 5 ? "warning" : stress < 10 ? "distress" : "severe";
  const zoneColors = {
    healthy:  { bar: "bg-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-800 dark:text-emerald-200", label: "Healthy" },
    warning:  { bar: "bg-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", text: "text-amber-800 dark:text-amber-200", label: "Warning" },
    distress: { bar: "bg-rose-500", bg: "bg-rose-50 dark:bg-rose-950/20", border: "border-rose-200 dark:border-rose-800", text: "text-rose-800 dark:text-rose-200", label: "Distress" },
    severe:   { bar: "bg-red-600", bg: "bg-red-50 dark:bg-red-950/20", border: "border-red-200 dark:border-red-800", text: "text-red-800 dark:text-red-200", label: "Severe" },
  };
  const c = zoneColors[zone];

  // Gauge bar width: cap at 12% for display (so even 15% doesn't overflow)
  const barPct = Math.min(stress / 12 * 100, 100);

  return (
    <div className={`rounded border p-4 ${c.border} ${c.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">ECL Stress Governor</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.bar} text-white`}>
            {c.label}
          </span>
        </div>
        {factor < 1.0 && (
          <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
            P/B fade: {(factor * 100).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Stress gauge bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
          <span>Uncovered Stress</span>
          <span className="font-mono font-semibold">{stress.toFixed(2)}%</span>
        </div>
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden relative">
          {/* Threshold markers */}
          <div className="absolute top-0 bottom-0 left-[16.7%] w-px bg-slate-400 dark:bg-slate-500 opacity-50" title="2% warning" />
          <div className="absolute top-0 bottom-0 left-[41.7%] w-px bg-slate-400 dark:bg-slate-500 opacity-50" title="5% distress" />
          <div className="absolute top-0 bottom-0 left-[83.3%] w-px bg-slate-400 dark:bg-slate-500 opacity-50" title="10% severe" />
          {/* Fill */}
          <div
            className={`h-full rounded-full transition-all ${c.bar}`}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
          <span>0%</span>
          <span>2%</span>
          <span>5%</span>
          <span>10%</span>
          <span>12%+</span>
        </div>
      </div>

      {/* Breakdown grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Stage 3</div>
          <div className="font-semibold font-mono">{ecl.latestStage3Pct != null ? ecl.latestStage3Pct.toFixed(2) + "%" : "—"}</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">ECL Coverage</div>
          <div className="font-semibold font-mono">{ecl.latestEclCoveragePct != null ? ecl.latestEclCoveragePct.toFixed(1) + "%" : "⚠️ missing"}</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Restructured</div>
          <div className="font-semibold font-mono">{ecl.latestRestructuredPct != null ? ecl.latestRestructuredPct.toFixed(2) + "%" : "—"}</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Stage 2</div>
          <div className="font-semibold font-mono">{ecl.latestStage2Pct != null ? ecl.latestStage2Pct.toFixed(2) + "%" : "—"}</div>
        </div>
      </div>

      {/* P/B fade detail (only when fade is active) */}
      {factor < 1.0 && (
        <div className="flex items-center gap-3 text-xs bg-white/60 dark:bg-slate-800/60 rounded p-2 mb-2">
          <div className="flex items-center gap-1">
            <span className="text-slate-500 dark:text-slate-400">Original P/B:</span>
            <span className="font-mono font-semibold">{ecl.originalPB.toFixed(2)}x</span>
          </div>
          <span className="text-slate-400">→</span>
          <div className="flex items-center gap-1">
            <span className="text-slate-500 dark:text-slate-400">Faded P/B:</span>
            <span className={`font-mono font-semibold ${c.text}`}>{ecl.effectivePB.toFixed(2)}x</span>
          </div>
          <span className="text-slate-400">→</span>
          <div className="flex items-center gap-1">
            <span className="text-slate-500 dark:text-slate-400">Factor:</span>
            <span className="font-mono font-semibold">{(factor * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* Stage 2 watchlist advisory */}
      {ecl.latestStage2Pct != null && ecl.latestStage2Pct > 3.0 && (
        <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
          ⚠️ Stage 2 watchlist at {ecl.latestStage2Pct.toFixed(1)}% — elevated migration risk to Stage 3.
        </div>
      )}
    </div>
  );
}

/**
 * Phase D3b — Spread Compression / Cost-of-Funds Sensitivity panel.
 *
 * Shows:
 *   - Current spread vs trailing median (compression gauge)
 *   - Cost-of-borrowings trend (rising/stable/falling)
 *   - Stress scenarios: ROA under +150bps and +250bps CoB shocks
 *   - Visual comparison bar: current ROA vs stressed ROA
 */
function SpreadCompressionPanel({ sc }: { sc: SpreadCompressionCheck }) {
  const spreadBps = sc.latestSpread != null ? (sc.latestSpread * 10000).toFixed(0) : "—";
  const medianBps = sc.medianSpread != null ? (sc.medianSpread * 10000).toFixed(0) : "—";
  const cobPct = sc.latestCostOfBorrowings != null ? (sc.latestCostOfBorrowings * 100).toFixed(2) : "—";
  const yieldPct = sc.latestYieldOnAdvances != null ? (sc.latestYieldOnAdvances * 100).toFixed(2) : "—";

  const zoneColors = {
    compressed: { bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", badge: "bg-amber-500", label: "Compressed" },
    normal:     { bg: "bg-slate-50 dark:bg-slate-900/20", border: "border-slate-200 dark:border-slate-700", badge: "bg-slate-500", label: "Normal" },
    expanding:  { bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", badge: "bg-emerald-500", label: "Expanding" },
    unknown:    { bg: "bg-slate-50 dark:bg-slate-900/20", border: "border-slate-200 dark:border-slate-700", badge: "bg-slate-400", label: "Unknown" },
  };
  const c = zoneColors[sc.severity];

  // ROA bar widths (scale: 0-5% ROA maps to 0-100% width)
  const roaScale = (v: number | null) => v != null ? Math.max(0, Math.min(100, (v / 0.05) * 100)) : 0;

  return (
    <div className={`rounded border p-4 ${c.border} ${c.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Cost-of-Funds Sensitivity</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.badge} text-white`}>
            {c.label}
          </span>
        </div>
        {sc.cobTrendBps != null && (
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
            sc.cobTrendBps > 20 ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300" :
            sc.cobTrendBps < -20 ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" :
            "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}>
            CoB {sc.cobTrendBps > 0 ? "+" : ""}{sc.cobTrendBps.toFixed(0)}bps YoY
          </span>
        )}
      </div>

      {/* Spread metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Yield</div>
          <div className="font-semibold font-mono">{yieldPct}%</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Cost of Borrowings</div>
          <div className="font-semibold font-mono">{cobPct}%</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Spread</div>
          <div className="font-semibold font-mono">{spreadBps}bps</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">vs Median</div>
          <div className="font-semibold font-mono">{medianBps}bps</div>
        </div>
      </div>

      {/* ROA stress scenario bars */}
      {sc.currentROA != null && (
        <div className="space-y-1.5 mb-2">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">ROA Stress Scenarios</div>
          {/* Current ROA */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] w-16 text-right text-slate-500">Current</span>
            <div className="flex-1 h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${roaScale(sc.currentROA)}%` }} />
            </div>
            <span className="text-[10px] w-12 font-mono">{(sc.currentROA * 100).toFixed(2)}%</span>
          </div>
          {/* +150bps stress */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] w-16 text-right text-slate-500">+150bps</span>
            <div className="flex-1 h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${
                sc.stressedROA_150bps != null && sc.stressedROA_150bps < 0.01 ? "bg-rose-500" : "bg-amber-500"
              }`} style={{ width: `${roaScale(sc.stressedROA_150bps)}%` }} />
            </div>
            <span className="text-[10px] w-12 font-mono">{sc.stressedROA_150bps != null ? (sc.stressedROA_150bps * 100).toFixed(2) + "%" : "—"}</span>
          </div>
          {/* +250bps stress */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] w-16 text-right text-slate-500">+250bps</span>
            <div className="flex-1 h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${
                sc.stressedROA_250bps != null && sc.stressedROA_250bps < 0.01 ? "bg-red-600" : "bg-rose-500"
              }`} style={{ width: `${roaScale(sc.stressedROA_250bps)}%` }} />
            </div>
            <span className="text-[10px] w-12 font-mono">{sc.stressedROA_250bps != null ? (sc.stressedROA_250bps * 100).toFixed(2) + "%" : "—"}</span>
          </div>
        </div>
      )}

      {/* Interpretation note */}
      {sc.stressedROA_150bps != null && sc.stressedROA_150bps < 0.01 && (
        <div className="text-xs text-rose-700 dark:text-rose-300 mt-1">
          ⚠️ A +150bps funding shock would push ROA below 1% — earnings fragility risk.
        </div>
      )}
      {sc.stressedROA_250bps != null && sc.stressedROA_250bps < 0 && (
        <div className="text-xs text-red-700 dark:text-red-300 mt-1">
          🚨 A +250bps shock would make the NBFC loss-making at current yields.
        </div>
      )}
    </div>
  );
}
