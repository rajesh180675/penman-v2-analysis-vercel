/* ================================================================
   Plan 2 PR-2.1 — useCommandPaletteShortcut

   Cmd+K / Ctrl+K toggles the command palette. Extracted from App.tsx
   so the keybind is reusable and unit-testable.
================================================================ */

import { useEffect } from "react";

/**
 * Toggle the command palette open/closed when the user presses
 * Cmd+K (macOS) or Ctrl+K. Works even while typing in inputs —
 * `preventDefault()` swallows the browser's default "search" binding.
 */
export function useCommandPaletteShortcut(setOpen: (updater: (o: boolean) => boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);
}
