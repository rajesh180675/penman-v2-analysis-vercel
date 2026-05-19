import { useState, useEffect } from "react";

export interface LibraryCompany {
  /** Folder name in public/data/companies/ */
  folder: string;
  /** Display name */
  name: string;
  /** NSE ticker, used as default ID */
  ticker: string;
  /** Sector category */
  sector: string;
  /** Type for routing/architecture */
  type: "industrial" | "bank" | "nbfc" | "insurance" | "it-services" | "utility" | "telecom" | "cyclical" | "loss-maker" | "conglomerate";
  /** One-line description */
  description: string;
  /** Visual identifier emoji */
  emoji: string;
  /** Why this is interesting for testing */
  showcaseFor?: string;
  /** Whether standalone statements are preloaded */
  hasStandalone?: boolean;
}

const COMPANIES: LibraryCompany[] = [
  {
    folder: "ITC",
    name: "ITC Ltd",
    ticker: "ITC",
    sector: "FMCG / Cigarettes",
    type: "conglomerate",
    description: "Diversified conglomerate — cigarettes, FMCG, hotels, paper, agri",
    emoji: "🚬",
    showcaseFor: "SOTP valuation across multiple segments",
    hasStandalone: true,
  },
  {
    folder: "HDFC Bank",
    name: "HDFC Bank",
    ticker: "HDFCBANK",
    sector: "Banking",
    type: "bank",
    description: "Largest private-sector bank by assets",
    emoji: "🏦",
    showcaseFor: "Bank-specific quality_indicators pipeline",
    hasStandalone: true,
  },
  {
    folder: "ICICI Bank",
    name: "ICICI Bank",
    ticker: "ICICIBANK",
    sector: "Banking",
    type: "bank",
    description: "Universal bank with strong digital franchise",
    emoji: "🏦",
    hasStandalone: true,
  },
  {
    folder: "KOTAKBANK",
    name: "Kotak Mahindra Bank",
    ticker: "KOTAKBANK",
    sector: "Banking",
    type: "bank",
    description: "Premium private bank with conservative loan book",
    emoji: "🏦",
    hasStandalone: false,
  },
  {
    folder: "SBIN",
    name: "State Bank of India",
    ticker: "SBIN",
    sector: "Banking (PSU)",
    type: "bank",
    description: "Largest public-sector bank",
    emoji: "🏛️",
    hasStandalone: false,
  },
  {
    folder: "Bajaj Finance",
    name: "Bajaj Finance",
    ticker: "BAJFINANCE",
    sector: "NBFC",
    type: "nbfc",
    description: "Consumer finance NBFC with retail loan focus",
    emoji: "💳",
    showcaseFor: "NBFC routing — borrowings/equity leverage frame",
    hasStandalone: true,
  },
  {
    folder: "Life Insurance Corporation of India",
    name: "LIC",
    ticker: "LICI",
    sector: "Insurance (Life)",
    type: "insurance",
    description: "State-owned life insurer, dominant market share",
    emoji: "🛡️",
    showcaseFor: "Insurance fail-closed (no equity-side valuation)",
    hasStandalone: true,
  },
  {
    folder: "Power Grid Corporation of India Ltd",
    name: "Power Grid",
    ticker: "POWERGRID",
    sector: "Utility (PSU)",
    type: "utility",
    description: "Inter-state electricity transmission monopoly",
    emoji: "⚡",
    showcaseFor: "Regulated utility with stable returns",
    hasStandalone: true,
  },
  {
    folder: "Tata Consultancy Services Ltd",
    name: "TCS",
    ticker: "TCS",
    sector: "IT Services",
    type: "it-services",
    description: "Global IT services leader, capital-light",
    emoji: "💻",
    showcaseFor: "IT-services detector + moat scorer awareness",
    hasStandalone: true,
  },
  {
    folder: "Tata Steel",
    name: "Tata Steel",
    ticker: "TATASTEEL",
    sector: "Metals (Cyclical)",
    type: "cyclical",
    description: "Integrated steel producer, India + Europe",
    emoji: "🏗️",
    showcaseFor: "Cyclical normalization + cycle-aware terminal RE",
    hasStandalone: true,
  },
  {
    folder: "Paytm",
    name: "Paytm (One97)",
    ticker: "PAYTM",
    sector: "Fintech",
    type: "loss-maker",
    description: "Digital payments + financial services platform",
    emoji: "📱",
    showcaseFor: "Loss-maker valuation pipeline (no positive earnings)",
    hasStandalone: true,
  },
  {
    folder: "Reliance Industries",
    name: "Reliance Industries",
    ticker: "RELIANCE",
    sector: "Conglomerate",
    type: "conglomerate",
    description: "O2C + telecom (Jio) + retail + new energy",
    emoji: "🛢️",
    showcaseFor: "Mixed conglomerate routing + segment-aware SOTP",
    hasStandalone: true,
  },
  {
    folder: "Vodafone Idea Ltd",
    name: "Vodafone Idea",
    ticker: "IDEA",
    sector: "Telecom",
    type: "telecom",
    description: "3rd-largest telco — chronic losses, negative net worth",
    emoji: "📡",
    showcaseFor: "Negative-equity stress test (distress detector)",
    hasStandalone: true,
  },
];

const TYPE_BADGE_STYLES: Record<LibraryCompany["type"], { bg: string; text: string; border: string; label: string }> = {
  industrial:    { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-700", label: "Industrial" },
  bank:          { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-700", label: "Bank" },
  nbfc:          { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-700", label: "NBFC" },
  insurance:     { bg: "bg-cyan-50 dark:bg-cyan-900/30", text: "text-cyan-700 dark:text-cyan-300", border: "border-cyan-200 dark:border-cyan-700", label: "Insurance" },
  "it-services": { bg: "bg-violet-50 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-300", border: "border-violet-200 dark:border-violet-700", label: "IT Services" },
  utility:       { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-700", label: "Utility" },
  telecom:       { bg: "bg-pink-50 dark:bg-pink-900/30", text: "text-pink-700 dark:text-pink-300", border: "border-pink-200 dark:border-pink-700", label: "Telecom" },
  cyclical:      { bg: "bg-orange-50 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", border: "border-orange-200 dark:border-orange-700", label: "Cyclical" },
  "loss-maker":  { bg: "bg-red-50 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", border: "border-red-200 dark:border-red-700", label: "Loss-maker" },
  conglomerate:  { bg: "bg-indigo-50 dark:bg-indigo-900/30", text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-200 dark:border-indigo-700", label: "Conglomerate" },
};

interface Props {
  /** Called when a company is picked. Receives the folder name (used by existing fetch logic).
   *  Phase A — also receives `hasStandalone` so the caller can decide whether to fetch
   *  both ZIPs (consolidated + standalone) for dual-scope analysis. */
  onPickCompany: (
    folder: string,
    ticker: string,
    type: LibraryCompany["type"],
    scope: "consolidated" | "standalone",
    hasStandalone: boolean,
  ) => void;
  /** Disabled state — used while a load is in progress */
  disabled?: boolean;
}

export default function CompanyLibraryGrid({ onPickCompany, disabled = false }: Props) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [scope, setScope] = useState<"consolidated" | "standalone">("consolidated");
  const [companies, setCompanies] = useState<LibraryCompany[]>(COMPANIES);

  useEffect(() => {
    fetch("/data/companies/registry.json")
      .then(res => {
        if (!res.ok) throw new Error("No registry.json");
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setCompanies(data);
        }
      })
      .catch(() => {
        console.log("Using static preloaded company library baseline.");
      });
  }, []);

  const filtered = companies.filter(c => {
    if (filter !== "all" && c.type !== filter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.sector.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const types = Array.from(new Set(companies.map(c => c.type)));

  return (
    <div className="space-y-4">
      {/* Header + filters + Scope Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Company Library</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {companies.length} pre-loaded Indian companies. Pick one to load consolidated data; standalone (when available) is fetched automatically for gap analysis.
          </p>
        </div>

        {/* Search, Sector, and Scope Filter Cluster */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Scope Toggle — kept for power users who want standalone-only.
              Default "Consolidated" auto-loads BOTH ZIPs and runs gap analysis.
              "Standalone" loads only standalone (legacy single-source path). */}
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/80 p-1 rounded-lg border border-slate-200 dark:border-slate-800" title="Default loads consolidated + standalone together for subsidiary contribution analysis. Toggle to standalone-only for niche use cases.">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Mode:</span>
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={() => setScope("consolidated")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  scope === "consolidated"
                    ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm border border-slate-200/50 dark:border-slate-600/50"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                Consolidated
              </button>
              <button
                type="button"
                onClick={() => setScope("standalone")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  scope === "standalone"
                    ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm border border-slate-200/50 dark:border-slate-600/50"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                Standalone
              </button>
            </div>
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All sectors</option>
            {types.map(t => (
              <option key={t} value={t}>{TYPE_BADGE_STYLES[t].label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <div className="text-3xl mb-2">🔍</div>
          <p className="text-sm">No companies match your filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => {
            const badge = TYPE_BADGE_STYLES[c.type];
            const isUnsupportedStandalone = scope === "standalone" && !c.hasStandalone;
            const isCardDisabled = disabled || isUnsupportedStandalone;

            return (
              <button
                key={c.folder}
                onClick={() => !isUnsupportedStandalone && onPickCompany(c.folder, c.ticker, c.type, scope, c.hasStandalone === true)}
                disabled={isCardDisabled}
                className={`text-left rounded-xl border p-4 transition-all duration-200 group ${
                  isUnsupportedStandalone
                    ? "border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/10 opacity-30 cursor-not-allowed select-none"
                    : isCardDisabled
                    ? "border-slate-200 bg-white opacity-50 cursor-not-allowed"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md cursor-pointer"
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-2xl shrink-0">{c.emoji}</span>
                    <div className="min-w-0">
                      <div className={`font-bold text-slate-800 dark:text-slate-100 transition-colors truncate ${!isCardDisabled && "group-hover:text-indigo-700 dark:group-hover:text-indigo-400"}`}>
                        {c.name}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 uppercase">{c.ticker}</div>
                    </div>
                  </div>
                  
                  {/* Badges cluster */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.bg} ${badge.text} ${badge.border}`}>
                      {badge.label}
                    </span>
                    {/* Phase C — Data availability badges. Always show what
                        ZIPs are available so the user knows up front whether
                        dual-scope analysis (consolidated + standalone) will run. */}
                    <div className="flex gap-1">
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60"
                        title="Consolidated statements available"
                      >
                        ✓ Cons
                      </span>
                      {c.hasStandalone ? (
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/60"
                          title="Standalone statements available — gap analysis will run automatically"
                        >
                          ✓ Stan
                        </span>
                      ) : (
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-50 dark:bg-slate-900/40 text-slate-400 dark:text-slate-600 border border-slate-200 dark:border-slate-800"
                          title="No standalone statements — only consolidated analysis"
                        >
                          – Stan
                        </span>
                      )}
                    </div>
                    {/* Legacy standalone-only banner kept for users who explicitly toggled scope */}
                    {scope === "standalone" && !c.hasStandalone && (
                      <span className="px-1.5 py-0.5 rounded-md text-[9px] font-extrabold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60">
                        🚫 Not available
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-400 leading-snug mb-2">{c.description}</div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{c.sector}</span>
                  {c.showcaseFor && !isUnsupportedStandalone && (
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 italic truncate" title={`Showcases: ${c.showcaseFor}`}>
                      ★ {c.showcaseFor.length > 28 ? c.showcaseFor.slice(0, 25) + "…" : c.showcaseFor}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
