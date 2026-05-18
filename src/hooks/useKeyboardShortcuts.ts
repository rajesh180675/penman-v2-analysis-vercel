import { useEffect, useRef } from "react";

type TabId = string;

interface UseKeyboardShortcutsArgs {
  setActiveTab: (tab: TabId) => void;
  setGlossaryOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  /** Disable shortcuts when a modal is already open (avoid hijacking inputs) */
  enabled?: boolean;
}

/**
 * Vim-style keyboard shortcuts.
 *   g d    -> Dashboard
 *   g u    -> Data (upload)
 *   g s    -> Statements
 *   g r    -> Ratios
 *   g f    -> Forecast
 *   g v    -> Valuation
 *   g q    -> Quality
 *   g c    -> Comparison
 *   g p    -> Report (export)
 *   ?      -> Show shortcuts panel
 *   Shift+? -> Open glossary
 *
 * Ignored when focus is in input/textarea/select/contentEditable.
 */
export function useKeyboardShortcuts({ setActiveTab, setGlossaryOpen, setShortcutsOpen, enabled = true }: UseKeyboardShortcutsArgs) {
  const pendingPrefix = useRef<string | null>(null);
  const prefixTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const clearPrefix = () => {
      pendingPrefix.current = null;
      if (prefixTimer.current != null) {
        window.clearTimeout(prefixTimer.current);
        prefixTimer.current = null;
      }
    };

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Single-key shortcuts
      if (!pendingPrefix.current) {
        if (e.key === "?") {
          e.preventDefault();
          if (e.shiftKey) {
            setGlossaryOpen(true);
          } else {
            setShortcutsOpen(true);
          }
          return;
        }
        // Start a 'g' prefix sequence
        if (e.key === "g") {
          pendingPrefix.current = "g";
          prefixTimer.current = window.setTimeout(clearPrefix, 1000);
          return;
        }
        return;
      }

      // 'g' prefix sequence — second key
      if (pendingPrefix.current === "g") {
        const map: Record<string, string> = {
          d: "dashboard",
          u: "upload",
          s: "statements",
          r: "ratios",
          f: "forecast",
          v: "valuation",
          q: "quality",
          c: "comparison",
          p: "report",
          b: "bank",
          w: "watchlist",
        };
        const tab = map[e.key.toLowerCase()];
        if (tab) {
          e.preventDefault();
          setActiveTab(tab);
        }
        clearPrefix();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearPrefix();
    };
  }, [setActiveTab, setGlossaryOpen, setShortcutsOpen, enabled]);
}
