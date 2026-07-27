/** @vitest-environment jsdom (mounts through react-dom/client) */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TabId } from "./tabs";
import { useConfigManager } from "./useConfigManager";

function ConfigProbe({
  setActiveTab,
  onHydrated,
}: {
  setActiveTab: (tab: TabId) => void;
  onHydrated: (value: { ticker: string | undefined; riskFreeRate: number; equityRiskPremium: number }) => void;
}) {
  const { config } = useConfigManager(setActiveTab);
  useEffect(() => {
    if (config.ticker !== "TCS") return;
    onHydrated({
      ticker: config.ticker,
      riskFreeRate: config.risk_free_rate,
      equityRiskPremium: config.equity_risk_premium,
    });
  }, [config, onHydrated]);
  return null;
}

describe("useConfigManager company deep links", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.classList.remove("dark");
  });

  it("hydrates the exact TCS URL and mounts DataEntry before ingestion", async () => {
    window.history.replaceState({}, "", "/?rf=7.00&erp=6.00&tab=valuation&dark=0&company=TCS");
    const setActiveTab = vi.fn<(tab: TabId) => void>();
    const onHydrated = vi.fn();

    await act(async () => {
      root.render(<ConfigProbe setActiveTab={setActiveTab} onHydrated={onHydrated} />);
    });

    await vi.waitFor(() => expect(onHydrated).toHaveBeenCalledWith({
      ticker: "TCS",
      riskFreeRate: 0.07,
      equityRiskPremium: 0.06,
    }));
    expect(setActiveTab).toHaveBeenCalledWith("upload");
    expect(setActiveTab).not.toHaveBeenCalledWith("valuation");
  });
});
