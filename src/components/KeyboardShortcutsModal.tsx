import { useEffect, useState } from "react";

interface ShortcutDef {
  keys: string[];
  description: string;
  category: "navigation" | "actions" | "modals";
}

const SHORTCUTS: ShortcutDef[] = [
  // Navigation
  { keys: ["g", "d"], description: "Go to Dashboard",     category: "navigation" },
  { keys: ["g", "u"], description: "Go to Data (upload)", category: "navigation" },
  { keys: ["g", "s"], description: "Go to Statements",    category: "navigation" },
  { keys: ["g", "r"], description: "Go to Ratios",        category: "navigation" },
  { keys: ["g", "f"], description: "Go to Forecast",      category: "navigation" },
  { keys: ["g", "v"], description: "Go to Valuation",     category: "navigation" },
  { keys: ["g", "q"], description: "Go to Quality",       category: "navigation" },
  { keys: ["g", "c"], description: "Go to Comparison",    category: "navigation" },
  { keys: ["g", "p"], description: "Go to Report (export)", category: "navigation" },

  // Modals
  { keys: ["?"],         description: "Show keyboard shortcuts (this panel)", category: "modals" },
  { keys: ["Shift", "?"], description: "Open Glossary",                       category: "modals" },
  { keys: ["Esc"],       description: "Close any open modal",                 category: "modals" },

  // Actions
  { keys: ["Ctrl", "P"], description: "Print / Save Dashboard as PDF (browser default)", category: "actions" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ open, onClose }: Props) {
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const q = filter.toLowerCase().trim();
  const filtered = SHORTCUTS.filter(s =>
    !q || s.description.toLowerCase().includes(q) || s.keys.join("").toLowerCase().includes(q)
  );

  const groups = [
    { key: "navigation" as const, label: "Navigation",  emoji: "🧭" },
    { key: "modals" as const,     label: "Modals",      emoji: "📋" },
    { key: "actions" as const,    label: "Actions",     emoji: "⚡" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">⌨️ Keyboard Shortcuts</h2>
            <p className="text-xs text-slate-500">Press <kbd className="px-1 rounded bg-slate-100 dark:bg-slate-800 font-mono">?</kbd> any time to open this panel</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl px-2" title="Close (ESC)">×</button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter shortcuts..."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-4">
          {groups.map(g => {
            const items = filtered.filter(s => s.category === g.key);
            if (items.length === 0) return null;
            return (
              <div key={g.key}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  {g.emoji} {g.label}
                </h3>
                <div className="space-y-1">
                  {items.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <span className="text-sm text-slate-700 dark:text-slate-300">{s.description}</span>
                      <div className="flex gap-1">
                        {s.keys.map((k, j) => (
                          <kbd
                            key={j}
                            className="min-w-[24px] px-2 py-0.5 text-center rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 italic">
          Tip: Vim-style 2-key sequences (e.g. <kbd className="px-1 rounded bg-slate-100 dark:bg-slate-800 font-mono">g</kbd>+<kbd className="px-1 rounded bg-slate-100 dark:bg-slate-800 font-mono">d</kbd>) — press the first key, then the second within 1 second.
        </div>
      </div>
    </div>
  );
}
