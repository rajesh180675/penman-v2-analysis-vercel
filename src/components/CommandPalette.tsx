import { useEffect, useRef, useState, useMemo } from "react";
import type { CompanyRegistry } from "../engine/types";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  category: "navigate" | "company" | "action" | "modal";
  icon: string;
  keywords: string[];
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  registry: CompanyRegistry;
  setActiveTab: (tab: string) => void;
  setGlossaryOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setDarkMode: (fn: (v: boolean) => boolean) => void;
  onSwitchCompany?: (companyId: string) => void;
}

/**
 * Command Palette — the central nervous system. Cmd+K / Ctrl+K to open,
 * fuzzy search across tabs, companies, modals, and actions.
 */
export default function CommandPalette({
  open, onClose, registry, setActiveTab, setGlossaryOpen, setShortcutsOpen, setDarkMode, onSwitchCompany,
}: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build command list
  const commands = useMemo<CommandItem[]>(() => {
    const navItems: CommandItem[] = [
      { id: "nav-dashboard", label: "Go to Dashboard", hint: "Single-screen overview + verdict", category: "navigate", icon: "📊", keywords: ["dashboard", "home", "overview", "verdict"], run: () => setActiveTab("dashboard") },
      { id: "nav-upload", label: "Go to Data (upload)", hint: "Upload Capitaline ZIP, configure", category: "navigate", icon: "📂", keywords: ["data", "upload", "input", "capitaline"], run: () => setActiveTab("upload") },
      { id: "nav-statements", label: "Go to Statements", hint: "Recast BS / IS / CF + waterfall charts", category: "navigate", icon: "📋", keywords: ["statements", "balance sheet", "income", "cash flow", "waterfall"], run: () => setActiveTab("statements") },
      { id: "nav-ratios", label: "Go to Ratios", hint: "Sparklines, DuPont waterfall, NSE bands", category: "navigate", icon: "📈", keywords: ["ratios", "roce", "rnoa", "dupont", "sparkline"], run: () => setActiveTab("ratios") },
      { id: "nav-forecast", label: "Go to Forecast", hint: "Scenarios, Monte Carlo, reverse DCF", category: "navigate", icon: "🔮", keywords: ["forecast", "scenarios", "monte carlo", "fade"], run: () => setActiveTab("forecast") },
      { id: "nav-valuation", label: "Go to Valuation", hint: "Framework radar, EPV, sensitivity, tornado", category: "navigate", icon: "🎯", keywords: ["valuation", "intrinsic", "epv", "moat", "tornado"], run: () => setActiveTab("valuation") },
      { id: "nav-quality", label: "Go to Quality", hint: "Piotroski / Altman / Beneish / Ohlson", category: "navigate", icon: "🩺", keywords: ["quality", "piotroski", "altman", "beneish", "distress"], run: () => setActiveTab("quality") },
      { id: "nav-bank", label: "Go to Bank Tab", hint: "NIM / ROA / ROE — bank/NBFC specific", category: "navigate", icon: "🏦", keywords: ["bank", "nbfc", "nim", "credit cost"], run: () => setActiveTab("bank") },
      { id: "nav-comparison", label: "Go to Comparison", hint: "Sector heatmap, scatter plots, peer values", category: "navigate", icon: "🆚", keywords: ["comparison", "peers", "scatter", "heatmap"], run: () => setActiveTab("comparison") },
      { id: "nav-watchlist", label: "Go to Watchlist", hint: "Ranked tracked companies", category: "navigate", icon: "🗂️", keywords: ["watchlist", "tracking", "ranked"], run: () => setActiveTab("watchlist") },
      { id: "nav-workspace", label: "Go to Workspace", hint: "Notes / research per company", category: "navigate", icon: "✏️", keywords: ["workspace", "notes", "research"], run: () => setActiveTab("workspace") },
      { id: "nav-report", label: "Go to Report (Export)", hint: "Generate Excel workbook", category: "navigate", icon: "📥", keywords: ["report", "export", "excel", "xlsx", "pdf"], run: () => setActiveTab("report") },
      { id: "nav-runs", label: "Go to Audit Runs", hint: "All runs, persisted to ~/.penman-data/audit/", category: "navigate", icon: "📜", keywords: ["runs", "audit", "history"], run: () => setActiveTab("inspector") },
    ];

    const modalItems: CommandItem[] = [
      { id: "modal-glossary", label: "Open Glossary", hint: "Definitions of RNOA / NOA / EPV / Piotroski / etc.", category: "modal", icon: "📖", keywords: ["glossary", "definitions", "help", "what is", "meaning"], run: () => setGlossaryOpen(true) },
      { id: "modal-shortcuts", label: "Show Keyboard Shortcuts", hint: "Vim-style g+letter sequences and more", category: "modal", icon: "⌨️", keywords: ["shortcuts", "keyboard", "keys", "hotkeys"], run: () => setShortcutsOpen(true) },
    ];

    const actionItems: CommandItem[] = [
      { id: "action-toggle-dark", label: "Toggle Dark Mode", category: "action", icon: "🌙", keywords: ["dark", "light", "theme", "mode", "color"], run: () => setDarkMode((v) => !v) },
      { id: "action-print", label: "Print / Save Dashboard as PDF", hint: "Browser print dialog with print stylesheet", category: "action", icon: "🖨️", keywords: ["print", "pdf", "export", "save"], run: () => window.print() },
    ];

    const companyItems: CommandItem[] = onSwitchCompany
      ? Object.values(registry.companies)
          .filter((c) => c.recastData.length > 0)
          .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id))
          .map((c) => ({
            id: `company-${c.id}`,
            label: `Switch to ${c.label || c.id}`,
            hint: `${c.recastData.length} periods loaded`,
            category: "company" as const,
            icon: "🏢",
            keywords: [c.id.toLowerCase(), (c.label || "").toLowerCase(), "company", "switch"],
            run: () => onSwitchCompany(c.id),
          }))
      : [];

    return [...navItems, ...modalItems, ...actionItems, ...companyItems];
  }, [registry, setActiveTab, setGlossaryOpen, setShortcutsOpen, setDarkMode, onSwitchCompany]);

  // Filter
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    const tokens = q.split(/\s+/);
    return commands.filter((c) => {
      const haystack = `${c.label} ${c.hint ?? ""} ${c.keywords.join(" ")}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [commands, query]);

  // Reset on open / close
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Key handling
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[highlight];
        if (cmd) {
          cmd.run();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, highlight, onClose]);

  if (!open) return null;

  const groups: Array<{ key: CommandItem["category"]; label: string }> = [
    { key: "navigate", label: "Navigate" },
    { key: "company", label: "Switch Company" },
    { key: "modal", label: "Open" },
    { key: "action", label: "Actions" },
  ];

  let runningIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <span className="text-xl">⌘</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search... go to tab, switch company, open glossary..."
            className="flex-1 bg-transparent outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">No matches for "{query}"</div>
          ) : (
            groups.map((g) => {
              const items = filtered.filter((c) => c.category === g.key);
              if (items.length === 0) return null;
              return (
                <div key={g.key} className="py-1">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{g.label}</div>
                  {items.map((c) => {
                    runningIndex++;
                    const isHighlighted = runningIndex === highlight;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onMouseEnter={() => setHighlight(filtered.indexOf(c))}
                        onClick={() => { c.run(); onClose(); }}
                        className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                          isHighlighted ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <span className="text-lg">{c.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${isHighlighted ? "text-indigo-700 dark:text-indigo-300" : "text-slate-800 dark:text-slate-200"}`}>
                            {c.label}
                          </div>
                          {c.hint && (
                            <div className="text-xs text-slate-500 truncate">{c.hint}</div>
                          )}
                        </div>
                        {isHighlighted && (
                          <kbd className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-mono">↵</kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
          <span>{filtered.length} of {commands.length} commands</span>
          <div className="flex gap-2">
            <span className="flex items-center gap-1"><kbd className="px-1 rounded bg-slate-100 dark:bg-slate-800 font-mono">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="px-1 rounded bg-slate-100 dark:bg-slate-800 font-mono">↵</kbd> run</span>
          </div>
        </div>
      </div>
    </div>
  );
}
