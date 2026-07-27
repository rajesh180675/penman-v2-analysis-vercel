import { useState, useEffect, useMemo } from "react";
import { trace } from "../../lib/traceLogger";
import { LibraryCompany, parseLibraryCompanyRegistry } from "./companyRegistry";

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
];

const TYPE_STYLES: Record<LibraryCompany["type"], { bg: string; text: string; label: string }> = {
  industrial:    { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Industrial" },
  bank:          { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", label: "Bank" },
  nbfc:          { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", label: "NBFC" },
  insurance:     { bg: "bg-cyan-50 dark:bg-cyan-900/30", text: "text-cyan-700 dark:text-cyan-300", label: "Insurance" },
  "it-services": { bg: "bg-violet-50 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-300", label: "IT Services" },
  consumer:      { bg: "bg-lime-50 dark:bg-lime-900/30", text: "text-lime-700 dark:text-lime-300", label: "Consumer" },
  utility:       { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", label: "Utility" },
  telecom:       { bg: "bg-pink-50 dark:bg-pink-900/30", text: "text-pink-700 dark:text-pink-300", label: "Telecom" },
  cyclical:      { bg: "bg-orange-50 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", label: "Cyclical" },
  "loss-maker":  { bg: "bg-red-50 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "Loss-maker" },
  conglomerate:  { bg: "bg-indigo-50 dark:bg-indigo-900/30", text: "text-indigo-700 dark:text-indigo-300", label: "Conglomerate" },
};

type SortKey = "name" | "ticker" | "sector" | "type";

interface Props {
  onPickCompany: (
    folder: string,
    ticker: string,
    type: LibraryCompany["type"],
    scope: "consolidated" | "standalone",
    hasStandalone: boolean,
    blobUrl?: string | undefined,
    standaloneBlobUrl?: string | undefined,
    qualityIndicatorsBlobUrl?: string | undefined,
  ) => void;
  onBatchRun?: ((companies: LibraryCompany[]) => void) | undefined;
  disabled?: boolean | undefined;
}

export default function CompanyLibraryGrid({ onPickCompany, onBatchRun, disabled = false }: Props) {
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [companies, setCompanies] = useState<LibraryCompany[]>(COMPANIES);

  useEffect(() => {
    fetch("/data/companies/registry.json")
      .then(res => {
        if (!res.ok) throw new Error("No registry.json");
        return res.json();
      })
      .then(data => {
        const parsed = parseLibraryCompanyRegistry(data);
        if (parsed.errors.length > 0) {
          trace("ui", "companyLibrary:registryValidationErrors", { errors: parsed.errors.slice(0, 10) }, null, { level: "warn" });
        }
        if (parsed.companies.length > 0) {
          setCompanies(parsed.companies);
        }
      })
      .catch(() => {
        trace("ui", "companyLibrary:usingStaticBaseline", null);
      });
  }, []);

  // Derive type counts for filter pills
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: companies.length };
    for (const c of companies) {
      counts[c.type] = (counts[c.type] || 0) + 1;
    }
    return counts;
  }, [companies]);

  const typeOrder = useMemo(() => {
    const seen = new Set<string>();
    for (const c of companies) {
      seen.add(c.type);
    }
    // Sort by count descending
    return [...seen].sort((a, b) => (typeCounts[b] || 0) - (typeCounts[a] || 0));
  }, [companies, typeCounts]);

  // Filter + sort
  const filtered = useMemo(() => {
    let list = companies;
    if (activeType !== "all") {
      list = list.filter(c => c.type === activeType);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.ticker.toLowerCase().includes(q) ||
        c.sector.toLowerCase().includes(q)
      );
    }
    // Sort
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
  }, [companies, activeType, search, sortKey]);

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Company Library
          </h3>
          <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
            {filtered.length}/{companies.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onBatchRun && (
            <button
              type="button"
              onClick={() => {
                trace("ui", "companyLibrary:batchRun", { count: filtered.length });
                onBatchRun(filtered);
              }}
              disabled={disabled || filtered.length === 0}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Batch analyze {filtered.length}
            </button>
          )}

          {/* Search */}
          <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ticker, sector…"
            className="text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 w-56 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
            >
              ✕
            </button>
          )}
          </div>
        </div>
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveType("all")}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
            activeType === "all"
              ? "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
          }`}
        >
          All {typeCounts.all}
        </button>
        {typeOrder.map(t => {
          const style = TYPE_STYLES[t as LibraryCompany["type"]];
          if (!style) return null;
          return (
            <button
              key={t}
              onClick={() => setActiveType(activeType === t ? "all" : t)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                activeType === t
                  ? "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 shadow-sm"
                  : `${style.bg} ${style.text} hover:opacity-80`
              }`}
            >
              {style.label} {typeCounts[t]}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-slate-400">
          <p className="text-sm">No companies match "{search || activeType}"</p>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2.5rem_1fr_5rem_1fr_6rem_4.5rem] gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            <span></span>
            <button onClick={() => setSortKey("name")} className={`text-left hover:text-slate-700 dark:hover:text-slate-200 ${sortKey === "name" ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
              Company {sortKey === "name" && "↓"}
            </button>
            <button onClick={() => setSortKey("ticker")} className={`text-left hover:text-slate-700 dark:hover:text-slate-200 ${sortKey === "ticker" ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
              Ticker {sortKey === "ticker" && "↓"}
            </button>
            <button onClick={() => setSortKey("sector")} className={`text-left hover:text-slate-700 dark:hover:text-slate-200 ${sortKey === "sector" ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
              Sector {sortKey === "sector" && "↓"}
            </button>
            <button onClick={() => setSortKey("type")} className={`text-left hover:text-slate-700 dark:hover:text-slate-200 ${sortKey === "type" ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
              Type {sortKey === "type" && "↓"}
            </button>
            <span className="text-center">Data</span>
          </div>

          {/* Rows */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map(c => {
              const style = TYPE_STYLES[c.type as keyof typeof TYPE_STYLES];
              if (!style) return null; // unknown type — skip row rather than crash
              return (
                <button
                  key={c.folder}
                  onClick={() => onPickCompany(c.folder, c.ticker, c.type, "consolidated", c.hasStandalone === true, c.blobUrl, c.standaloneBlobUrl, c.qualityIndicatorsBlobUrl)}
                  disabled={disabled}
                  className={`w-full grid grid-cols-[2.5rem_1fr_5rem_1fr_6rem_4.5rem] gap-2 px-3 py-2.5 text-left transition-all group ${
                    disabled
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 cursor-pointer"
                  }`}
                  title={c.description}
                >
                  {/* Emoji */}
                  <span className="text-lg leading-none self-center">{c.emoji}</span>

                  {/* Name */}
                  <div className="min-w-0 self-center">
                    <span className={`text-sm font-semibold text-slate-800 dark:text-slate-100 truncate block ${!disabled && "group-hover:text-indigo-700 dark:group-hover:text-indigo-300"}`}>
                      {c.name}
                    </span>
                  </div>

                  {/* Ticker */}
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400 self-center">
                    {c.ticker}
                  </span>

                  {/* Sector */}
                  <span className="text-xs text-slate-600 dark:text-slate-400 self-center truncate">
                    {c.sector}
                  </span>

                  {/* Type badge */}
                  <span className={`self-center px-2 py-0.5 rounded-full text-[10px] font-bold ${style.bg} ${style.text} text-center`}>
                    {style.label}
                  </span>

                  {/* Data availability */}
                  <div className="flex items-center justify-center gap-1 self-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" title="Consolidated ✓"></span>
                    <span className={`w-2 h-2 rounded-full ${c.hasStandalone ? "bg-indigo-500" : "bg-slate-300 dark:bg-slate-600"}`} title={c.hasStandalone ? "Standalone ✓" : "No standalone"}></span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer hint */}
      <p className="text-[10px] text-slate-600 dark:text-slate-400 text-center">
        Click a company to load. Consolidated + standalone (when available) loaded together for gap analysis.
      </p>
    </div>
  );
}
