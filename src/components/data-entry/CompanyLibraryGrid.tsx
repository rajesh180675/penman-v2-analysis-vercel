import { useState } from "react";

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
  },
  {
    folder: "HDFC bank",
    name: "HDFC Bank",
    ticker: "HDFCBANK",
    sector: "Banking",
    type: "bank",
    description: "Largest private-sector bank by assets",
    emoji: "🏦",
    showcaseFor: "Bank-specific quality_indicators pipeline",
  },
  {
    folder: "ICICI bank",
    name: "ICICI Bank",
    ticker: "ICICIBANK",
    sector: "Banking",
    type: "bank",
    description: "Universal bank with strong digital franchise",
    emoji: "🏦",
  },
  {
    folder: "KOTAKBANK",
    name: "Kotak Mahindra Bank",
    ticker: "KOTAKBANK",
    sector: "Banking",
    type: "bank",
    description: "Premium private bank with conservative loan book",
    emoji: "🏦",
  },
  {
    folder: "SBIN",
    name: "State Bank of India",
    ticker: "SBIN",
    sector: "Banking (PSU)",
    type: "bank",
    description: "Largest public-sector bank",
    emoji: "🏛️",
  },
  {
    folder: "bajaj finance",
    name: "Bajaj Finance",
    ticker: "BAJFINANCE",
    sector: "NBFC",
    type: "nbfc",
    description: "Consumer finance NBFC with retail loan focus",
    emoji: "💳",
    showcaseFor: "NBFC routing — borrowings/equity leverage frame",
  },
  {
    folder: "Life Insurance Corporation of India",
    name: "LIC",
    ticker: "LIFI",
    sector: "Insurance (Life)",
    type: "insurance",
    description: "State-owned life insurer, dominant market share",
    emoji: "🛡️",
    showcaseFor: "Insurance fail-closed (no equity-side valuation)",
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
  },
  {
    folder: "Tata steel",
    name: "Tata Steel",
    ticker: "TATASTEEL",
    sector: "Metals (Cyclical)",
    type: "cyclical",
    description: "Integrated steel producer, India + Europe",
    emoji: "🏗️",
    showcaseFor: "Cyclical normalization + cycle-aware terminal RE",
  },
  {
    folder: "paytm",
    name: "Paytm (One97)",
    ticker: "PAYTM",
    sector: "Fintech",
    type: "loss-maker",
    description: "Digital payments + financial services platform",
    emoji: "📱",
    showcaseFor: "Loss-maker valuation pipeline (no positive earnings)",
  },
  {
    folder: "reliance Industries",
    name: "Reliance Industries",
    ticker: "RELIANCE",
    sector: "Conglomerate",
    type: "conglomerate",
    description: "O2C + telecom (Jio) + retail + new energy",
    emoji: "🛢️",
    showcaseFor: "Mixed conglomerate routing + segment-aware SOTP",
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
  /** Called when a company is picked. Receives the folder name (used by existing fetch logic). */
  onPickCompany: (folder: string, ticker: string, type: LibraryCompany["type"]) => void;
  /** Disabled state — used while a load is in progress */
  disabled?: boolean;
}

export default function CompanyLibraryGrid({ onPickCompany, disabled = false }: Props) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const filtered = COMPANIES.filter(c => {
    if (filter !== "all" && c.type !== filter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.sector.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const types = Array.from(new Set(COMPANIES.map(c => c.type)));

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Company Library</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {COMPANIES.length} pre-loaded Indian companies covering every sector and architecture type
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
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
            return (
              <button
                key={c.folder}
                onClick={() => onPickCompany(c.folder, c.ticker, c.type)}
                disabled={disabled}
                className="text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-2xl shrink-0">{c.emoji}</span>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 transition-colors truncate">{c.name}</div>
                      <div className="text-[10px] font-mono text-slate-400 uppercase">{c.ticker}</div>
                    </div>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.bg} ${badge.text} ${badge.border}`}>
                    {badge.label}
                  </span>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-400 leading-snug mb-2">{c.description}</div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{c.sector}</span>
                  {c.showcaseFor && (
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
