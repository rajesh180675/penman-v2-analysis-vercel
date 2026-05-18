import { useState, useRef, useEffect } from "react";

interface GlossaryEntry {
  term: string;
  abbr?: string;
  category: "ratio" | "balance-sheet" | "income" | "valuation" | "quality" | "forecast";
  definition: string;
  formula?: string;
  example?: string;
}

const GLOSSARY: GlossaryEntry[] = [
  // Ratios
  { term: "RNOA", category: "ratio", definition: "Return on Net Operating Assets — operating return on the assets actually used to run the business", formula: "OI / Avg NOA", example: "An RNOA of 15% means the operating business earns 15¢ on every rupee of net operating assets" },
  { term: "ROCE", category: "ratio", definition: "Return on Capital Employed — total return on equity + debt capital", formula: "EBIT / (Equity + Debt)" },
  { term: "PM", abbr: "Profit Margin", category: "ratio", definition: "Operating profit as a fraction of sales", formula: "OI / Sales" },
  { term: "ATO", abbr: "Asset Turnover", category: "ratio", definition: "How many rupees of sales each rupee of operating assets generates", formula: "Sales / Avg NOA", example: "ATO of 2x means ₹2 of sales per ₹1 of NOA" },
  { term: "FLEV", abbr: "Financial Leverage", category: "ratio", definition: "Net financial obligations relative to equity. Higher means more debt-financed", formula: "NFO / CSE" },
  { term: "SPREAD", category: "ratio", definition: "RNOA minus cost of borrowing — the operating return earned above debt cost", formula: "RNOA - NBC" },
  { term: "NBC", abbr: "Net Borrowing Cost", category: "ratio", definition: "Effective cost of net financial obligations", formula: "NFE / Avg NFO" },
  { term: "CCR", abbr: "Cash Conversion Ratio", category: "ratio", definition: "How well accounting earnings translate into cash", formula: "CFO / PAT" },

  // Balance Sheet
  { term: "NOA", abbr: "Net Operating Assets", category: "balance-sheet", definition: "Operating assets minus operating liabilities. The capital actually deployed in the business", formula: "OA - OL" },
  { term: "OA", abbr: "Operating Assets", category: "balance-sheet", definition: "Total assets minus financial assets. Inventory, receivables, PP&E, goodwill, etc.", formula: "TA - FA" },
  { term: "OL", abbr: "Operating Liabilities", category: "balance-sheet", definition: "Trade payables, provisions, deferred tax — non-financial liabilities", formula: "Total Liab - FO" },
  { term: "FA", abbr: "Financial Assets", category: "balance-sheet", definition: "Cash, marketable securities, derivatives — financial-side assets" },
  { term: "FO", abbr: "Financial Obligations", category: "balance-sheet", definition: "Debt + financial liabilities. The financing side" },
  { term: "NFO", abbr: "Net Financial Obligations", category: "balance-sheet", definition: "Debt minus financial assets. Net debt position", formula: "FO - FA" },
  { term: "CSE", abbr: "Common Shareholders' Equity", category: "balance-sheet", definition: "Equity attributable to common shareholders (excludes preferred and minority interest)" },

  // Income
  { term: "OI", abbr: "Operating Income", category: "income", definition: "Operating profit after tax. Excludes financing income/expense", example: "EBIT × (1 - tax rate)" },
  { term: "NFE", abbr: "Net Financial Expense", category: "income", definition: "Interest expense minus interest income, after tax" },
  { term: "CNI", abbr: "Common Net Income", category: "income", definition: "Net income attributable to common shareholders. Excludes preferred dividends and minority interest" },
  { term: "CoreOI", abbr: "Core Operating Income", category: "income", definition: "OI excluding unusual items — the recurring earnings base" },
  { term: "UOI", abbr: "Unusual Operating Items", category: "income", definition: "One-off gains/losses excluded from CoreOI" },

  // Valuation
  { term: "EPV", abbr: "Earnings Power Value", category: "valuation", definition: "Graham-Dodd / Greenwald no-growth floor — what the business is worth if it never grows again. CoreOI / ke", formula: "CoreOI / ke" },
  { term: "RE", abbr: "Residual Earnings", category: "valuation", definition: "Earnings above cost of equity. Drives intrinsic value above book", formula: "(RNOA - ke) × NOA" },
  { term: "ReOI", abbr: "Residual Operating Income", category: "valuation", definition: "Operating income above operating cost of capital" },
  { term: "SOTP", abbr: "Sum-of-the-Parts", category: "valuation", definition: "Value each business segment separately, then sum. Used for conglomerates" },
  { term: "MoS", abbr: "Margin of Safety", category: "valuation", definition: "Discount of intrinsic value vs market price. Buffett's safety cushion", formula: "(Intrinsic - Price) / Price" },
  { term: "ke", category: "valuation", definition: "Cost of equity — required return for shareholders. Risk-free rate + equity risk premium × beta" },
  { term: "kw", category: "valuation", definition: "WACC-style blended cost of capital used for operating valuation" },
  { term: "g", category: "valuation", definition: "Terminal growth rate — long-run perpetuity growth assumption (usually 3-5% in India)" },
  { term: "Reverse DCF", category: "valuation", definition: "Solve for what growth the market is implicitly pricing — keeps you honest" },
  { term: "CAP", abbr: "Competitive Advantage Period", category: "valuation", definition: "How long a company can earn excess returns before competition erodes them. Estimated from RNOA persistence (AR-1 fade)" },

  // Quality scores
  { term: "Piotroski F-Score", category: "quality", definition: "9-point fundamentals improvement checklist (profitability, leverage, operating efficiency). 7-9 strong, <3 weak" },
  { term: "Altman Z'-Score", category: "quality", definition: "Bankruptcy distress score for non-manufacturing. >2.9 safe, 1.23-2.9 grey, <1.23 distressed" },
  { term: "Beneish M-Score", category: "quality", definition: "Earnings manipulation flag. < -2.22 clean, > -1.78 manipulation flag" },
  { term: "Zmijewski X-Score", category: "quality", definition: "Statistical bankruptcy probability. <0 low risk, >1 high risk" },
  { term: "Ohlson O-Score", category: "quality", definition: "Logistic-regression bankruptcy probability. <18% low, >50% high" },
  { term: "Wide Moat", category: "quality", definition: "Durable competitive advantage allowing sustained excess returns >10 years (Buffett's term)" },

  // Forecast
  { term: "Stress Scenario", category: "forecast", definition: "Pessimistic path — sharp margin compression + working capital deterioration" },
  { term: "Panic Scenario", category: "forecast", definition: "Historical-panic-like drawdown calibrated against 2008 / 2020 patterns" },
  { term: "Base Scenario", category: "forecast", definition: "Most likely path. Mean-reversion to industry medians" },
  { term: "Bull Scenario", category: "forecast", definition: "Optimistic path — margin expansion + ATO improvement" },
  { term: "Monte Carlo", category: "forecast", definition: "10,000-path simulation using historical driver volatilities. Produces a distribution of intrinsic values" },
];

const CATEGORY_COLORS: Record<GlossaryEntry["category"], { bg: string; text: string; label: string }> = {
  ratio:          { bg: "bg-blue-100 dark:bg-blue-900/40",       text: "text-blue-700 dark:text-blue-300",       label: "Ratio" },
  "balance-sheet":{ bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", label: "Balance Sheet" },
  income:         { bg: "bg-amber-100 dark:bg-amber-900/40",     text: "text-amber-700 dark:text-amber-300",     label: "Income" },
  valuation:      { bg: "bg-indigo-100 dark:bg-indigo-900/40",   text: "text-indigo-700 dark:text-indigo-300",   label: "Valuation" },
  quality:        { bg: "bg-purple-100 dark:bg-purple-900/40",   text: "text-purple-700 dark:text-purple-300",   label: "Quality" },
  forecast:       { bg: "bg-rose-100 dark:bg-rose-900/40",       text: "text-rose-700 dark:text-rose-300",       label: "Forecast" },
};

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Glossary modal — searchable definitions of all financial terms used
 * in the app. Helps non-experts understand RNOA / NOA / Penman-Nissim jargon.
 */
export default function GlossaryModal({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<GlossaryEntry["category"] | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search on open + ESC to close
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.toLowerCase().trim();
  const filtered = GLOSSARY.filter(e => {
    if (activeCategory !== "all" && e.category !== activeCategory) return false;
    if (!q) return true;
    return (
      e.term.toLowerCase().includes(q) ||
      (e.abbr?.toLowerCase().includes(q) ?? false) ||
      e.definition.toLowerCase().includes(q)
    );
  });

  const categories: Array<{ key: typeof activeCategory; label: string }> = [
    { key: "all", label: "All" },
    { key: "ratio", label: "Ratios" },
    { key: "balance-sheet", label: "Balance Sheet" },
    { key: "income", label: "Income" },
    { key: "valuation", label: "Valuation" },
    { key: "quality", label: "Quality" },
    { key: "forecast", label: "Forecast" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">📖 Financial Glossary</h2>
            <p className="text-xs text-slate-500">Definitions for every term used in the app — Penman-Nissim, valuation, quality scores</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl leading-none px-2"
            title="Close (ESC)"
          >
            ×
          </button>
        </div>

        {/* Search + categories */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 space-y-2">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search RNOA, ATO, EPV, Piotroski, ..."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap gap-1">
            {categories.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => setActiveCategory(c.key)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                  activeCategory === c.key
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No matches for "{query}"
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((e, i) => {
                const cat = CATEGORY_COLORS[e.category];
                return (
                  <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <div className="flex items-baseline gap-2 flex-wrap mb-1">
                      <span className="font-bold text-slate-900 dark:text-slate-100">{e.term}</span>
                      {e.abbr && <span className="text-xs text-slate-500">— {e.abbr}</span>}
                      <span className={`ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold ${cat.bg} ${cat.text}`}>
                        {cat.label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{e.definition}</p>
                    {e.formula && (
                      <div className="mt-1.5 text-xs font-mono text-indigo-700 dark:text-indigo-300">
                        Formula: {e.formula}
                      </div>
                    )}
                    {e.example && (
                      <div className="mt-1 text-xs text-slate-500 italic">
                        Example: {e.example}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
          <span>{filtered.length} of {GLOSSARY.length} terms</span>
          <span>ESC to close · Type to filter</span>
        </div>
      </div>
    </div>
  );
}
