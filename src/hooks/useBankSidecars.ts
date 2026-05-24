import { useState, useEffect, useMemo } from "react";
import { fetchBankQualityIndicators, type BankQualityIndicators } from "../engine/bankQualityIndicators";
import { fetchNbfcSidecarData, type NbfcSidecarData } from "../engine/nbfcSidecarLoader";
import { trace } from "../lib/traceLogger";
import type { RawPeriodData, EngineConfig } from "../engine/types";

/**
 * Fetches bank/NBFC quality sidecars when a financial-institution dataset
 * is loaded. Returns null gracefully when data is unavailable or the company
 * type doesn't require sidecars.
 */
export function useBankSidecars(
  config: EngineConfig,
  rawData: RawPeriodData[] | null,
): { bankQuality: BankQualityIndicators | null; nbfcSidecar: NbfcSidecarData | null } {
  const [bankQuality, setBankQuality] = useState<BankQualityIndicators | null>(null);
  const [nbfcSidecar, setNbfcSidecar] = useState<NbfcSidecarData | null>(null);

  const qualityFolder = useMemo(() => {
    return config.quality_data_folder ?? rawData?.[0]?.company_id ?? null;
  }, [config.quality_data_folder, rawData]);

  // Bank quality indicators fetch
  useEffect(() => {
    let cancelled = false;
    if (!qualityFolder) {
      setBankQuality(null);
      return;
    }
    const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const qualityUrl = (!isLocalDev && config.quality_indicators_blob_url)
      ? `${config.quality_indicators_blob_url}?v=${Date.now()}`
      : undefined;
    const qualitySource = qualityUrl ? "blob" : "local";
    trace("quality", "useEffect:fetchStart", { folder: qualityFolder, source: qualitySource, isLocalDev, url: qualityUrl ?? `local:/data/companies/${qualityFolder}/quality_indicators.json` });
    void fetchBankQualityIndicators(qualityFolder, undefined, qualityUrl)
      .then((q) => {
        if (!cancelled) {
          setBankQuality(q);
          trace("quality", "sidecarLoaded", {
            folder: qualityFolder,
            periods: q?.periods?.length ?? 0,
            hasData: q != null,
            hasSubsidiaries: q?.periods?.filter((p) => p.subsidiaries != null).length ?? 0,
          });
        }
      })
      .catch((err) => {
        console.error("[useBankSidecars] bank quality sidecar load failed:", err);
        trace("quality", "sidecarLoadError", { folder: qualityFolder, error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
        if (!cancelled) setBankQuality(null);
      });
    return () => { cancelled = true; };
  }, [qualityFolder, config.quality_indicators_blob_url]);

  // NBFC sidecar (LGD + RBI NHB) — only for NBFC companies
  const isNbfcCompany = config.company_type === "nbfc";
  useEffect(() => {
    let cancelled = false;
    if (!qualityFolder || !isNbfcCompany) {
      setNbfcSidecar(null);
      return;
    }
    const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const sidecarBlobRoot = (!isLocalDev && config.quality_indicators_blob_url)
      ? config.quality_indicators_blob_url.replace(/\/companies\/[^/]+\/quality_indicators\.json$/, "")
      : null;
    trace("sidecar", "nbfcSidecar:useEffectStart", { folder: qualityFolder, sidecarBlobRoot, isLocalDev });
    void fetchNbfcSidecarData(qualityFolder, sidecarBlobRoot)
      .then((data) => {
        if (!cancelled) {
          trace("sidecar", "nbfcSidecarFetched", {
            folder: qualityFolder,
            lgdPeriods: data.lgd.length,
            rbiNhbPeriods: data.rbiNhb.length,
          });
          if (data.lgd.length > 0 || data.rbiNhb.length > 0) {
            setNbfcSidecar(data);
          } else {
            trace("sidecar", "nbfcSidecarEmpty", { folder: qualityFolder }, null, { level: "info", msg: "LGD+RBI NHB empty — expected for non-NBFC companies" });
            setNbfcSidecar(null);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          trace("sidecar", "nbfcSidecarError", { folder: qualityFolder, error: String(err) }, null, { level: "error" });
          setNbfcSidecar(null);
        }
      });
    return () => { cancelled = true; };
  }, [qualityFolder, config.quality_indicators_blob_url, isNbfcCompany]);

  return { bankQuality, nbfcSidecar };
}
