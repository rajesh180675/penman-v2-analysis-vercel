interface ActionItem {
  icon: string;
  label: string;
  description: string;
  tab: string;
  primary?: boolean | undefined;
}

interface Props {
  /** Current verdict — drives which next steps are emphasized */
  verdict?: "screaming-buy" | "buy" | "hold" | "avoid" | "distressed" | null | undefined;
  /** Whether peers are loaded (enables Comparison shortcut) */
  hasPeers: boolean;
  /** Navigation callback */
  onNavigate?: ((tab: string) => void) | undefined;
}

/**
 * Next Steps panel — actionable CTAs at the bottom of the Dashboard.
 * Recommends what to do next based on the verdict and available data.
 */
export default function NextStepsPanel({ verdict, hasPeers, onNavigate }: Props) {
  // Verdict-aware CTAs
  const baseActions: ActionItem[] = [
    {
      icon: "🎯",
      label: "Detailed Valuation",
      description: "Drill into the Framework Radar, Sensitivity Heatmap, and EPV calculations",
      tab: "valuation",
      primary: verdict === "buy" || verdict === "screaming-buy" || verdict === "hold",
    },
    {
      icon: "🩺",
      label: "Quality Audit",
      description: "Check Piotroski / Altman / Beneish / Zmijewski / Ohlson distress scores",
      tab: "quality",
      primary: verdict === "distressed" || verdict === "avoid",
    },
    {
      icon: "📊",
      label: "Recast Statements",
      description: "Income waterfall, balance sheet composition, cash flow trends",
      tab: "statements",
    },
    {
      icon: "🔮",
      label: "Forecast Scenarios",
      description: "Base / Bull / Bear / Stress paths with reverse DCF and Monte Carlo",
      tab: "forecast",
    },
  ];

  if (hasPeers) {
    baseActions.push({
      icon: "🆚",
      label: "Peer Comparison",
      description: "Sector heatmap, scatter plots, percentile bands, peer-implied fair values",
      tab: "comparison",
      primary: verdict === "hold",
    });
  }

  baseActions.push({
    icon: "📥",
    label: "Export Excel Report",
    description: "Multi-sheet workbook: recast statements, ratios, forecast, valuation, traceability",
    tab: "report",
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/40 dark:to-slate-900/20 dark:border-slate-700 p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">🧭</span>
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Where to Next?</h3>
          <p className="text-xs text-slate-500">
            Based on the dashboard signals, here's what's worth digging into.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {baseActions.map((a, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onNavigate?.(a.tab)}
            className={`text-left p-4 rounded-xl border transition-all ${
              a.primary
                ? "border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 hover:border-indigo-400 hover:shadow-md"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 hover:border-slate-300 hover:shadow-sm"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{a.icon}</span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold ${a.primary ? "text-indigo-700 dark:text-indigo-300" : "text-slate-800 dark:text-slate-200"}`}>
                  {a.label}
                  {a.primary && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{a.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 italic">
        💡 Tip: the most useful tabs depend on the verdict. Buy/Hold candidates benefit most from Valuation depth.
        Avoid/Distressed candidates need a Quality audit first.
      </div>
    </div>
  );
}
