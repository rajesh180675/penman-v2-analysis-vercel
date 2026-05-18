import { useCallback, useEffect, useMemo, useState } from "react";
import { LiveMarketDataSnapshot } from "../engine/marketData";

interface Params {
  provider?: "manual" | "upstox-readonly" | "alphavantage" | "nse" | "disabled";
  symbol?: string | null;
  instrumentKey?: string | null;
  fallbackPrice?: number | null;
  fallbackRiskFreeRate?: number | null;
  refreshSeconds?: number | null;
}

export function useLiveMarketData({
  provider,
  symbol,
  instrumentKey,
  fallbackPrice,
  fallbackRiskFreeRate,
  refreshSeconds,
}: Params) {
  const [snapshot, setSnapshot] = useState<LiveMarketDataSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (provider) params.set("provider", provider);
    if (symbol) params.set("symbol", symbol);
    if (instrumentKey) params.set("instrumentKey", instrumentKey);
    if (fallbackPrice != null && Number.isFinite(fallbackPrice)) params.set("fallbackPrice", String(fallbackPrice));
    if (fallbackRiskFreeRate != null && Number.isFinite(fallbackRiskFreeRate)) params.set("fallbackRiskFreeRate", String(fallbackRiskFreeRate));
    return params.toString();
  }, [fallbackPrice, fallbackRiskFreeRate, instrumentKey, provider, symbol]);

  const load = useCallback(async () => {
    if (provider === "disabled") {
      setSnapshot(null);
      return;
    }
    if (!symbol && !instrumentKey && fallbackPrice == null && fallbackRiskFreeRate == null) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/market-data/snapshot?${query}`);
      if (!response.ok) throw new Error(`Market snapshot failed with ${response.status}`);
      const payload = await response.json();
      setSnapshot(payload.snapshot ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fallbackPrice, fallbackRiskFreeRate, instrumentKey, provider, query, symbol]);

  useEffect(() => {
    void load();
    const intervalMs = Math.max((refreshSeconds ?? 300) * 1000, 30_000);
    const timer = window.setInterval(() => {
      void load();
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [load, refreshSeconds]);

  return {
    snapshot,
    loading,
    error,
    refresh: load,
  };
}
