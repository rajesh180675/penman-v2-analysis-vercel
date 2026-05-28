import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trace } from "../lib/traceLogger";
import { LiveMarketDataSnapshot } from "../engine/marketData";

interface Params {
  provider?: "manual" | "upstox-readonly" | "alphavantage" | "nse" | "yahoo" | "disabled" | undefined;
  symbol?: string | null | undefined;
  instrumentKey?: string | null | undefined;
  fallbackPrice?: number | null | undefined;
  fallbackRiskFreeRate?: number | null | undefined;
  refreshSeconds?: number | null | undefined;
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

  // Stash the latest load() inputs in a ref so the polling effect doesn't have
  // to re-subscribe (and tear down/re-create the interval) on every config tick.
  const latestRef = useRef({ provider, symbol, instrumentKey, fallbackPrice, fallbackRiskFreeRate, query });
  latestRef.current = { provider, symbol, instrumentKey, fallbackPrice, fallbackRiskFreeRate, query };

  const load = useCallback(async () => {
    const { provider, symbol, instrumentKey, fallbackPrice, fallbackRiskFreeRate, query } = latestRef.current;
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
      trace("fetch", "marketData:success", {
        provider, symbol,
        price: payload.snapshot?.lastPrice ?? null,
        change: payload.snapshot?.changePct ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      trace("fetch", "marketData:error", { provider, symbol, error: msg }, null, { level: "warn" });
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch immediately when the request inputs change (cheap; just one fetch).
  useEffect(() => { void load(); }, [query, load]);

  // Polling loop is independent of the input churn. Only re-creates when the
  // user-visible refresh cadence changes.
  useEffect(() => {
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
