interface Props {
  /** True if the user has data loaded — show a more compact "data loaded" version */
  hasData: boolean;
}

/**
 * First-time onboarding card on the Data tab.
 * Compact "loaded" state when data is present, expansive welcome when empty.
 */
export default function OnboardingCard({ hasData }: Props) {
  if (hasData) {
    return null; // Once data is loaded, don't show — the bottom strip already confirms.
  }

  return (
    <div className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-900/30 dark:to-blue-900/20 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="text-4xl">👋</div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Welcome to Penman V2 Analysis</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">
            A complete Indian-equity valuation workbench. Upload financial data, get a buy/hold/avoid verdict in 10 seconds, drill into the detail when you want it.
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg bg-white/70 dark:bg-slate-900/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">①</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Fill 4 essentials</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Company ID, Type, Market Price, Shares Outstanding. That's it for the must-haves.
              </p>
            </div>

            <div className="rounded-lg bg-white/70 dark:bg-slate-900/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">②</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Upload data</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Drop a Capitaline ZIP, paste Screener.in tables, or pick from the bundled library.
              </p>
            </div>

            <div className="rounded-lg bg-white/70 dark:bg-slate-900/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">③</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Read the verdict</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Dashboard auto-opens with a buy/hold/avoid verdict, narrative, and ~12 charts.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium">
              ✓ Penman-Nissim recasting
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium">
              ✓ Moat scoring (5 dimensions)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium">
              ✓ EPV + DCF + SOTP triangulation
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
              ✓ Bank/NBFC/Insurance pipelines
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-medium">
              ✓ Distress detection
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
              ✓ 663 tests · sector sanity bands
            </span>
          </div>

          <p className="mt-4 text-xs text-slate-500 italic">
            New here? Use the <strong>Load from Library</strong> dropdown below to try ITC, HDFC Bank, TCS, or any of the 11 bundled examples — no upload needed.
          </p>
        </div>
      </div>
    </div>
  );
}
