/* ================================================================
   useConfigManager — extracted from AppShell.tsx

   Owns the EngineConfig state, URL-param hydration, and dark-mode
   toggle. Exposes a stable `configRef` so callbacks (e.g.
   handleDataSubmit) can read the latest config without stale closures.

   NOTE: The shares_outstanding auto-fill effect remains in AppShell
   because it depends on recastData (produced by useAuditAnalysis),
   which is called after this hook. Moving it here would create a
   circular dependency.
================================================================ */

import { useState, useEffect, useRef } from "react";
import { DEFAULT_CONFIG, EngineConfig } from "../engine/types";
import type { TabId } from "./tabs";
import { TABS } from "./tabs";

export interface ConfigManagerReturn {
  config: EngineConfig;
  setConfig: React.Dispatch<React.SetStateAction<EngineConfig>>;
  /** Always holds the latest config — safe to read from callbacks. */
  configRef: React.MutableRefObject<EngineConfig>;
  darkMode: boolean;
  setDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Manages EngineConfig lifecycle:
 *   1. Initializes from DEFAULT_CONFIG
 *   2. Hydrates from URL params on mount (rf, erp, company, dark)
 *   3. Maintains a configRef that's always current (fixes stale closures)
 *
 * @param setActiveTab — needed for the URL-param `tab` hydration
 */
export function useConfigManager(
  setActiveTab: (tab: TabId) => void,
): ConfigManagerReturn {
  const [config, setConfig] = useState<EngineConfig>(DEFAULT_CONFIG);
  const [darkMode, setDarkMode] = useState(false);

  // ── configRef: always-current config for callback use ──────────────
  // Replaces the stale `let latestConfig = config; setConfig(prev => { latestConfig = prev; return prev; })`
  // anti-pattern that was in handleDataSubmit.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // ── URL param hydration (one-shot on mount) ────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rf = Number(params.get("rf"));
    const erp = Number(params.get("erp"));
    const company = params.get("company");
    const tab = params.get("tab") as TabId | null;
    const dark = params.get("dark");
    setConfig((prev) => ({
      ...prev,
      risk_free_rate: Number.isFinite(rf) && rf > 0 ? rf / 100 : prev.risk_free_rate,
      equity_risk_premium: Number.isFinite(erp) && erp > 0 ? erp / 100 : prev.equity_risk_premium,
      ticker: company || prev.ticker,
    }));
    // A company deep link must mount DataEntry first so the bundled ZIP can be
    // resolved and ingested. AppShell retains the requested destination and
    // restores it after ingestion completes.
    if (company) setActiveTab("upload");
    else if (tab && TABS.some((t) => t.id === tab)) setActiveTab(tab);
    if (dark === "1") setDarkMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dark mode class toggle ─────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return { config, setConfig, configRef, darkMode, setDarkMode };
}
