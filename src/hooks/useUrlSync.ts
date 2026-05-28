/* ================================================================
   Plan 2 PR-2.1 — useUrlSync

   Two-way sync between URL search params and the App's primary
   surface state (rate inputs, ticker, active tab, dark mode).
   Extracted from App.tsx; observable behaviour is identical.
================================================================ */

import { useEffect } from "react";

export interface UrlSyncSnapshot {
  riskFreeRate: number;
  equityRiskPremium: number;
  ticker: string | null | undefined;
  activeTab: string;
  darkMode: boolean;
}

/**
 * Pushes state into `?rf=...&erp=...&company=...&tab=...&dark=...`.
 * `replaceState` is used so the user's history is not polluted on
 * every keystroke.
 *
 * Companion: callers should still parse the URL on mount via their
 * own one-shot useEffect (the read-side has tab-validation logic
 * that's specific to the consumer).
 */
export function useUrlSync(snapshot: UrlSyncSnapshot) {
  const { riskFreeRate, equityRiskPremium, ticker, activeTab, darkMode } = snapshot;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("rf", (riskFreeRate * 100).toFixed(2));
    params.set("erp", (equityRiskPremium * 100).toFixed(2));
    if (ticker) params.set("company", ticker);
    params.set("tab", activeTab);
    params.set("dark", darkMode ? "1" : "0");
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", next);
  }, [riskFreeRate, equityRiskPremium, ticker, activeTab, darkMode]);
}
