import { useState, useCallback, useMemo } from "react";
import { RawPeriodData, EngineConfig, validateEngineConfig } from "../engine/types";
import type { CapitalineParseDebug } from "../engine/capitalineParser";
import { parseScreenerTabDelimitedDetailed } from "../engine/screenerParser";
import { parseRawPeriodsJsonDetailed } from "../engine/jsonIngestion";
import { parseXbrlXmlDetailed } from "../engine/xbrlParser";
import { diagnoseManualRawPeriods } from "../engine/manualEntryParser";
import { SourceParserDiagnostics } from "../engine/parserDiagnostics";
import {
  AuditSubmissionMeta,
  createAuditAccessToken,
  createAuditRunId,
  getAuditClientGovernance,
  persistAuditEvent,
  persistAuditFile,
  rememberAuditRun,
} from "../lib/audit";
import { trace } from "../lib/traceLogger";
import ManualEntryWizard from "./ManualEntryWizard";
import OnboardingCard from "./dashboard/OnboardingCard";
import CompanyLibraryGrid from "./data-entry/CompanyLibraryGrid";

interface Props {
  onDataSubmit: (
    data: RawPeriodData[],
    debug?: CapitalineParseDebug,
    meta?: AuditSubmissionMeta,
    parserDiagnostics?: SourceParserDiagnostics | null,
    segmentData?: import("../engine/segmentParser").SegmentData | null,
    // Phase A — optional standalone dataset for dual-scope (consolidated + standalone)
    // analysis. When present, App computes the gap (cons − stan = subsidiary
    // contribution). null when only consolidated was loaded.
    standaloneData?: RawPeriodData[] | null,
  ) => void;
  currentData: RawPeriodData[] | null;
  config: EngineConfig;
  onConfigChange: (cfg: EngineConfig) => void;
}

export default function DataEntry({ onDataSubmit, currentData, config, onConfigChange }: Props) {
  const [mode, setMode] = useState<"capitaline" | "screener" | "json" | "xbrl" | "manual">("capitaline");
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: number } | null>(null);
  const [uploadStep, setUploadStep] = useState<"idle" | "unzipping" | "parsing" | "success" | "failed">("idle");
  const [error, setError]     = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [companyId, setCompanyId] = useState("VST");
  const [_lastFile, setLastFile] = useState<string | null>(null);
  const [screenerText, setScreenerText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [showCostOfCapital, setShowCostOfCapital] = useState(false);
  // Multi-slot upload state
  const [standaloneFile, setStandaloneFile] = useState<File | null>(null);
  const [qualitySidecarFile, setQualitySidecarFile] = useState<File | null>(null);
  const [dragOverStandalone, setDragOverStandalone] = useState(false);
  const [dragOverQuality, setDragOverQuality] = useState(false);
  const auditGovernance = getAuditClientGovernance();

  // Fix 10: live config validation — catches ke=130, g≥ke, etc.
  const configWarnings = useMemo(() => validateEngineConfig(config), [config]);
  // Gate: company_type must be explicitly declared before any data can load.
  const typeNotSelected = !config.company_type || config.company_type === "auto";

  const buildMeta = useCallback(
    (sourceMode: AuditSubmissionMeta["sourceMode"], overrides?: Partial<AuditSubmissionMeta>): AuditSubmissionMeta => {
      const meta = {
        runId: overrides?.runId ?? createAuditRunId(),
        sourceMode,
        companyId: overrides?.companyId ?? companyId,
        fileName: overrides?.fileName ?? null,
        runAccessToken: overrides?.runAccessToken ?? createAuditAccessToken(),
        contentClass: overrides?.contentClass ?? auditGovernance.contentClass,
        retentionDays: overrides?.retentionDays ?? auditGovernance.retentionDays,
      } satisfies AuditSubmissionMeta;
      rememberAuditRun(meta);
      return meta;
    },
    [auditGovernance.contentClass, auditGovernance.retentionDays, companyId]
  );

  const processZip = useCallback(async (
    file: File,
    overrideCompanyId?: string,
    // Phase A — optional pre-parsed standalone periods. When the library card
    // loaded both consolidated + standalone, the caller parses standalone
    // first (so failures don't abort consolidated) and passes the periods here.
    standalonePeriods?: RawPeriodData[] | null,
  options?: { skipTypeCheck?: boolean },
  ) => {
    if (typeNotSelected && !options?.skipTypeCheck) {
      setError("Select a Company Type before uploading.");
      trace("ui", "processZip:blocked", { reason: "typeNotSelected" }, null, { level: "warn" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Please upload a .zip file containing Capitaline XLS exports.");
      setUploadStep("failed");
      trace("ui", "processZip:rejected", { fileName: file.name, reason: "not-zip" }, null, { level: "warn" });
      return;
    }
    const t0 = performance.now();
    trace("parse", "processZip:start", { fileName: file.name, size: file.size, hasStandalone: !!standalonePeriods });
    setIsProcessing(true);
    setError("");
    setLastFile(file.name);
    setUploadedFile({ name: file.name, size: file.size });
    setUploadStep("unzipping");
    const activeCompanyId = overrideCompanyId || companyId;
    const meta = buildMeta("capitaline", { fileName: file.name, companyId: activeCompanyId });
    try {
      await persistAuditEvent({
        runId: meta.runId,
        eventType: "run-started",
        companyId: meta.companyId,
        sourceMode: meta.sourceMode,
        payload: {
          fileName: file.name,
          ingestionMode: "capitaline",
        },
      });
      await persistAuditFile({
        runId: meta.runId,
        kind: "inputs",
        eventType: "input-file-uploaded",
        file,
        filename: file.name,
        companyId: meta.companyId,
        sourceMode: meta.sourceMode,
        maximumSizeInBytes: auditGovernance.maximumUploadBytes,
        contentClass: meta.contentClass,
        retentionDays: meta.retentionDays,
      });
      const { parseCapitalineZip } = await import("../engine/capitalineParser");
      setUploadStep("parsing");
      const { periods, debug, segmentData } = await parseCapitalineZip(file, { companyId: activeCompanyId });
      trace("parse", "processZip:parsed", { fileName: file.name }, {
        periodCount: periods.length,
        filesInZip: debug?.files.length ?? 0,
        rawMetricKeys: debug?.rawMetricKeys.length ?? 0,
        hasSegmentData: !!segmentData,
      }, { duration_ms: Math.round(performance.now() - t0) });
      await persistAuditEvent({
        runId: meta.runId,
        eventType: "input-ingested",
        companyId: meta.companyId,
        sourceMode: meta.sourceMode,
        payload: {
          fileName: file.name,
          periodCount: periods.length,
          debugSummary: debug
            ? {
                files: debug.files.length,
                rawMetricKeys: debug.rawMetricKeys.length,
              }
            : null,
        },
      });
      onDataSubmit(periods, debug, meta, null, segmentData, standalonePeriods ?? null);
      if (periods.length === 0) {
        setError("Parsed 0 periods. Check Debug tab for details.");
        setUploadStep("failed");
        trace("parse", "processZip:empty", { fileName: file.name }, null, { level: "warn", msg: "0 periods parsed" });
      } else {
        setUploadStep("success");
        trace("parse", "processZip:success", null, { periodCount: periods.length, companyId: activeCompanyId });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      trace("parse", "processZip:error", { fileName: file.name }, { error: errMsg }, { level: "error" });
      await persistAuditEvent({
        runId: meta.runId,
        eventType: "input-ingest-failed",
        companyId: meta.companyId,
        sourceMode: meta.sourceMode,
        payload: {
          fileName: file.name,
          error: errMsg,
        },
      });
      setError(`Failed: ${errMsg}`);
      setUploadStep("failed");
    } finally { setIsProcessing(false); }
  }, [auditGovernance.maximumUploadBytes, buildMeta, companyId, onDataSubmit]);

  // Parse standalone ZIP for manual upload path
  const parseStandaloneZip = useCallback(async (file: File): Promise<RawPeriodData[] | null> => {
    const t0 = performance.now();
    trace("parse", "standaloneZip:start", { fileName: file.name, size: file.size });
    try {
      const { parseCapitalineZip } = await import("../engine/capitalineParser");
      const { periods } = await parseCapitalineZip(file, { companyId });
      trace("parse", "standaloneZip:success", null, {
        periodCount: periods.length,
      }, { duration_ms: Math.round(performance.now() - t0) });
      return periods.length > 0 ? periods : null;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      trace("parse", "standaloneZip:error", { fileName: file.name }, { error: errMsg }, { level: "error" });
      // Non-fatal — standalone is optional
      return null;
    }
  }, [companyId]);

  // Parse quality sidecar JSON for manual upload path
  // TODO: Wire into App.tsx quality pipeline (currently quality is fetched by URL in App.tsx)
  const parseQualitySidecar = useCallback(async (file: File): Promise<Record<string, unknown> | null> => {
    trace("quality", "sidecarUpload:start", { fileName: file.name, size: file.size });
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== "object") {
        trace("quality", "sidecarUpload:invalidJson", { fileName: file.name }, null, { level: "warn" });
        return null;
      }
      trace("quality", "sidecarUpload:success", null, {
        hasSchemaVersion: !!data.schema_version,
        periodCount: Array.isArray(data.periods) ? data.periods.length : 0,
      });
      return data;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      trace("quality", "sidecarUpload:error", { fileName: file.name }, { error: errMsg }, { level: "error" });
      return null;
    }
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processZip(file);
  };

  const handleLoadSample = () => {
    const meta = buildMeta("sample", { fileName: "embedded-vst-sample" });
    void persistAuditEvent({
      runId: meta.runId,
      eventType: "run-started",
      companyId: meta.companyId,
      sourceMode: meta.sourceMode,
      payload: {
        fileName: meta.fileName,
        ingestionMode: "sample",
      },
    });
    // VST Industries — 15 years of real data
    const sample: RawPeriodData[] = [
      { company_id: "VST", period_end: "2011-03-31", raw_metric_values: { "Total Assets": 639, "Total Equity": 264, "Minority Interest": 0, "Cash and Cash Equivalents": 29, "Bank Balances Other Than Cash and Cash Equivalents": 0, "Current Investments": 149, "Investments - Long-term": 0, "Others Financial Assets - Short-term": 0, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 0, "Revenue From Operations(Net)": 0, "Other Income": 0, "Total Comprehensive Income for the Year": 0, "Non-Controlling Interests": 0, "Profit After Tax": 0, "Finance Cost": 0, "Tax Expenses": 0, "Profit Before Tax": 0, "Net Cash from Operating Activities": 85, "Purchased of Fixed Assets": 44, "Dividend Paid": 54, "Exceptional Items Before Tax": 0, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": 0, "Interest Received": 2, "Dividend Received": 5, "P/L on Sales of Invest": -7 } },
      { company_id: "VST", period_end: "2016-03-31", raw_metric_values: { "Total Assets": 827, "Total Equity": 370, "Minority Interest": 0, "Cash and Cash Equivalents": 14, "Bank Balances Other Than Cash and Cash Equivalents": 0, "Current Investments": 160, "Investments - Long-term": 0, "Others Financial Assets - Short-term": 0, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 0, "Revenue From Operations(Net)": 495, "Other Income": 21, "Total Comprehensive Income for the Year": 133, "Non-Controlling Interests": 0, "Profit After Tax": 133, "Finance Cost": 0, "Tax Expenses": -5, "Profit Before Tax": 128, "Net Cash from Operating Activities": 132, "Purchased of Fixed Assets": 52, "Dividend Paid": 130, "Exceptional Items Before Tax": -73, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": 0, "Interest Received": 0, "Dividend Received": 0, "P/L on Sales of Invest": -19 } },
      { company_id: "VST", period_end: "2017-03-31", raw_metric_values: { "Total Assets": 798, "Total Equity": 539, "Minority Interest": 0, "Cash and Cash Equivalents": 12, "Bank Balances Other Than Cash and Cash Equivalents": 8, "Current Investments": 172, "Investments - Long-term": 2, "Others Financial Assets - Short-term": 0, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 10, "Revenue From Operations(Net)": 522, "Other Income": 29, "Total Comprehensive Income for the Year": 199, "Non-Controlling Interests": 0, "Profit After Tax": 199, "Finance Cost": 0, "Tax Expenses": 5, "Profit Before Tax": 203, "Net Cash from Operating Activities": 146, "Purchased of Fixed Assets": 45, "Dividend Paid": 130, "Exceptional Items Before Tax": 4, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": 0, "Interest Received": 0, "Dividend Received": 0, "P/L on Sales of Invest": -17 } },
      { company_id: "VST", period_end: "2018-03-31", raw_metric_values: { "Total Assets": 1064, "Total Equity": 582, "Minority Interest": 0, "Cash and Cash Equivalents": 29, "Bank Balances Other Than Cash and Cash Equivalents": 9, "Current Investments": 414, "Investments - Long-term": 2, "Others Financial Assets - Short-term": 0, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 13, "Revenue From Operations(Net)": 434, "Other Income": 217, "Total Comprehensive Income for the Year": 563, "Non-Controlling Interests": 0, "Profit After Tax": 564, "Finance Cost": 0, "Tax Expenses": 50, "Profit Before Tax": 614, "Net Cash from Operating Activities": 420, "Purchased of Fixed Assets": 45, "Dividend Paid": 139, "Exceptional Items Before Tax": 316, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": -1, "Interest Received": 0, "Dividend Received": 0, "P/L on Sales of Invest": 0 } },
      { company_id: "VST", period_end: "2019-03-31", raw_metric_values: { "Total Assets": 1205, "Total Equity": 664, "Minority Interest": 0, "Cash and Cash Equivalents": 26, "Bank Balances Other Than Cash and Cash Equivalents": 10, "Current Investments": 573, "Investments - Long-term": 2, "Others Financial Assets - Short-term": 1, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 13, "Revenue From Operations(Net)": 576, "Other Income": 37, "Total Comprehensive Income for the Year": 200, "Non-Controlling Interests": 0, "Profit After Tax": 201, "Finance Cost": 0, "Tax Expenses": 17, "Profit Before Tax": 219, "Net Cash from Operating Activities": 290, "Purchased of Fixed Assets": 26, "Dividend Paid": 144, "Exceptional Items Before Tax": 5, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": -1, "Interest Received": 0, "Dividend Received": 0, "P/L on Sales of Invest": 0 } },
      { company_id: "VST", period_end: "2020-03-31", raw_metric_values: { "Total Assets": 1397, "Total Equity": 787, "Minority Interest": 0, "Cash and Cash Equivalents": 26, "Bank Balances Other Than Cash and Cash Equivalents": 11, "Current Investments": 751, "Investments - Long-term": 2, "Others Financial Assets - Short-term": 0, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 24, "Revenue From Operations(Net)": 518, "Other Income": 24, "Total Comprehensive Income for the Year": 173, "Non-Controlling Interests": 0, "Profit After Tax": 174, "Finance Cost": 0, "Tax Expenses": 2, "Profit Before Tax": 175, "Net Cash from Operating Activities": 331, "Purchased of Fixed Assets": 22, "Dividend Paid": 177, "Exceptional Items Before Tax": 92, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": 0, "Interest Received": 0, "Dividend Received": 0, "P/L on Sales of Invest": 0 } },
      { company_id: "VST", period_end: "2021-03-31", raw_metric_values: { "Total Assets": 1486, "Total Equity": 940, "Minority Interest": 0, "Cash and Cash Equivalents": 9, "Bank Balances Other Than Cash and Cash Equivalents": 11, "Current Investments": 884, "Investments - Long-term": 3, "Others Financial Assets - Short-term": 1, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 38, "Revenue From Operations(Net)": 537, "Other Income": 28, "Total Comprehensive Income for the Year": 100, "Non-Controlling Interests": 0, "Profit After Tax": 97, "Finance Cost": 0, "Tax Expenses": 19, "Profit Before Tax": 116, "Net Cash from Operating Activities": 286, "Purchased of Fixed Assets": 46, "Dividend Paid": 159, "Exceptional Items Before Tax": -15, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": 3, "Interest Received": 0, "Dividend Received": 0, "P/L on Sales of Invest": 0 } },
      { company_id: "VST", period_end: "2022-03-31", raw_metric_values: { "Total Assets": 1591, "Total Equity": 1074, "Minority Interest": 0, "Cash and Cash Equivalents": 4, "Bank Balances Other Than Cash and Cash Equivalents": 11, "Current Investments": 768, "Investments - Long-term": 203, "Others Financial Assets - Short-term": 3, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 32, "Revenue From Operations(Net)": 698, "Other Income": 26, "Total Comprehensive Income for the Year": 196, "Non-Controlling Interests": 0, "Profit After Tax": 195, "Finance Cost": 0, "Tax Expenses": 66, "Profit Before Tax": 261, "Net Cash from Operating Activities": 277, "Purchased of Fixed Assets": 49, "Dividend Paid": 176, "Exceptional Items Before Tax": 0, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": 1, "Interest Received": 10, "Dividend Received": 0, "P/L on Sales of Invest": 0 } },
      { company_id: "VST", period_end: "2023-03-31", raw_metric_values: { "Total Assets": 1654, "Total Equity": 1180, "Minority Interest": 0, "Cash and Cash Equivalents": 9, "Bank Balances Other Than Cash and Cash Equivalents": 11, "Current Investments": 376, "Investments - Long-term": 202, "Others Financial Assets - Short-term": 3, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 42, "Revenue From Operations(Net)": 709, "Other Income": 33, "Total Comprehensive Income for the Year": 196, "Non-Controlling Interests": 0, "Profit After Tax": 167, "Finance Cost": 0, "Tax Expenses": 71, "Profit Before Tax": 238, "Net Cash from Operating Activities": 181, "Purchased of Fixed Assets": 404, "Dividend Paid": 215, "Exceptional Items Before Tax": 0, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": 0, "Interest Received": 17, "Dividend Received": 0, "P/L on Sales of Invest": 0 } },
      { company_id: "VST", period_end: "2024-03-31", raw_metric_values: { "Total Assets": 1720, "Total Equity": 1252, "Minority Interest": 0, "Cash and Cash Equivalents": 24, "Bank Balances Other Than Cash and Cash Equivalents": 11, "Current Investments": 247, "Investments - Long-term": 200, "Others Financial Assets - Short-term": 3, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 48, "Revenue From Operations(Net)": 1258, "Other Income": 34, "Total Comprehensive Income for the Year": 754, "Non-Controlling Interests": 0, "Profit After Tax": 753, "Finance Cost": 0, "Tax Expenses": 165, "Profit Before Tax": 919, "Net Cash from Operating Activities": 167, "Purchased of Fixed Assets": 94, "Dividend Paid": 231, "Exceptional Items Before Tax": 504, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": 1, "Interest Received": 13, "Dividend Received": 0, "P/L on Sales of Invest": 0 } },
      { company_id: "VST", period_end: "2025-03-31", raw_metric_values: { "Total Assets": 1816, "Total Equity": 1323, "Minority Interest": 0, "Cash and Cash Equivalents": 6, "Bank Balances Other Than Cash and Cash Equivalents": 11, "Current Investments": 332, "Investments - Long-term": 199, "Others Financial Assets - Short-term": 3, "Long Term Borrowings": 0, "Short Term Borrowings": 0, "Lease Liabilities": 0, "Others Financial Liabilities - Long-term": 0, "Others Financial Liabilities - Short-term": 50, "Revenue From Operations(Net)": 2883, "Other Income": 29, "Total Comprehensive Income for the Year": 1110, "Non-Controlling Interests": 0, "Profit After Tax": 1112, "Finance Cost": 0, "Tax Expenses": 363, "Profit Before Tax": 1475, "Net Cash from Operating Activities": 193, "Purchased of Fixed Assets": 41, "Dividend Paid": 231, "Exceptional Items Before Tax": -90, "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss": -3, "Interest Received": 15, "Dividend Received": 0, "P/L on Sales of Invest": 0 } },
    ];
    void persistAuditEvent({
      runId: meta.runId,
      eventType: "sample-loaded",
      companyId: meta.companyId,
      sourceMode: meta.sourceMode,
      payload: {
        fileName: meta.fileName,
        periodCount: sample.length,
        periods: sample.map((period) => period.period_end),
      },
    });
    onDataSubmit(sample, undefined, meta);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <OnboardingCard hasData={!!(currentData && currentData.length > 0)} />

      {/* Company library grid — primary way to load data on first run */}
      {mode === "capitaline" && !(currentData && currentData.length > 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 dark:bg-slate-900/60 dark:border-slate-700 p-6">
          <CompanyLibraryGrid
            disabled={isProcessing}
            onPickCompany={async (folder, ticker, type, scope, hasStandalone, blobUrl, standaloneBlobUrl, qualityIndicatorsBlobUrl) => {
              try {
                setIsProcessing(true); setError("");

                // Wire chosen company parameters directly to the engine configuration
                onConfigChange({
                  ...config,
                  quality_data_folder: folder,
                  quality_indicators_blob_url: qualityIndicatorsBlobUrl ?? null,
                  market_data_symbol: ticker,
                  ticker: ticker,
                  // Map all registry types to a valid CompanyType — never fall back to "auto".
                  // conglomerate → industrial; all others map directly.
                  company_type: (["bank","nbfc","insurance","it-services","consumer","utility","telecom","cyclical"] as string[]).includes(type)
                    ? (type as EngineConfig["company_type"])
                    : "industrial",
                });

                // Phase A — dual-scope loading. When the company has standalone
                // available, fetch BOTH consolidated and standalone ZIPs in
                // parallel. Consolidated drives the main pipeline; standalone
                // feeds the subsidiary contribution gap analysis.
                //
                // Legacy: when scope==="standalone" the user explicitly opted
                // into standalone-only analysis (rare; keep it working).
                const useDualScope = scope === "consolidated" && hasStandalone === true;
                // Prefer Vercel Blob URLs when available (Vercel deploy);
                // fall back to local public/ paths (local dev).
                const consolidatedUrl = blobUrl ?? `/data/companies/${encodeURIComponent(folder)}/${encodeURIComponent(folder)}.zip`;
                const standaloneUrl   = standaloneBlobUrl ?? `/data/companies/${encodeURIComponent(folder)}/standalone.zip`;

                if (useDualScope) {
                  // Parallel fetch of both ZIPs
                  const [consResp, stanResp] = await Promise.all([
                    fetch(consolidatedUrl),
                    fetch(standaloneUrl),
                  ]);
                  if (!consResp.ok) throw new Error(`Consolidated ZIP not found for "${folder}".`);
                  // Standalone failure is non-fatal — fall back to consolidated-only
                  const consBlob = await consResp.blob();
                  const consFile = new File([consBlob], `${folder}.zip`, { type: "application/zip" });
                  setCompanyId(ticker.toUpperCase().slice(0, 20));

                  let standalonePeriods: RawPeriodData[] | null = null;
                  if (stanResp.ok) {
                    try {
                      const stanBlob = await stanResp.blob();
                      const stanFile = new File([stanBlob], "standalone.zip", { type: "application/zip" });
                      const { parseCapitalineZip } = await import("../engine/capitalineParser");
                      const stanResult = await parseCapitalineZip(stanFile, { companyId: ticker.toUpperCase().slice(0, 20) });
                      standalonePeriods = stanResult.periods.length > 0 ? stanResult.periods : null;
                    } catch (stanErr) {
                      // Standalone parse failure shouldn't block consolidated analysis
                      const msg = stanErr instanceof Error ? stanErr.message : String(stanErr);
                      trace("ui", "dataEntry:standaloneParseFailed", { folder, error: msg }, null, { level: "warn" });
                    }
                  }
                  await processZip(consFile, ticker.toUpperCase().slice(0, 20), standalonePeriods, { skipTypeCheck: true });
                } else {
                  // Single-scope path (legacy: user picked Standalone explicitly,
                  // OR company has no standalone available)
                  const zipName = scope === "standalone" ? "standalone.zip" : `${folder}.zip`;
                  const zipUrl = scope === "standalone"
                    ? (standaloneBlobUrl ?? `/data/companies/${encodeURIComponent(folder)}/standalone.zip`)
                    : (blobUrl ?? `/data/companies/${encodeURIComponent(folder)}/${encodeURIComponent(zipName)}`);
                  const resp = await fetch(zipUrl);
                  if (!resp.ok) throw new Error(`Library ${scope} ZIP not found for "${folder}".`);
                  const blob = await resp.blob();
                  const file = new File([blob], zipName, { type: "application/zip" });
                  setCompanyId(ticker.toUpperCase().slice(0, 20));
                  await processZip(file, ticker.toUpperCase().slice(0, 20), undefined, { skipTypeCheck: true });
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setIsProcessing(false);
              }
            }}
          />
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-center">
            <p className="text-xs text-slate-500">
              Or scroll down to upload your own Capitaline ZIP, paste from Screener.in, or build manually.
            </p>
          </div>
        </div>
      )}

      {/* Phase C — Mode tabs hidden behind a disclosure when on the default
          Capitaline path. First-time users see the library + Capitaline upload
          only; "Other formats" reveals Screener / JSON / XBRL / Manual when
          power users need them. */}
      <details className="bg-white rounded-xl border border-slate-200 dark:bg-slate-900/40 dark:border-slate-700">
        <summary className="px-3 py-2 cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 select-none">
          {mode === "capitaline" ? "📂 Capitaline ZIP (default)" : `🔧 ${
            mode === "screener" ? "Screener Paste" :
            mode === "json" ? "Raw JSON" :
            mode === "xbrl" ? "XBRL XML" : "Manual Wizard"
          }`}
          <span className="ml-2 text-slate-400">— change format</span>
        </summary>
        <div className="px-3 pb-3 pt-1 inline-flex gap-2 flex-wrap">
          {([
            ["capitaline", "Capitaline ZIP"],
            ["screener", "Screener Paste"],
            ["json", "Raw JSON"],
            ["xbrl", "XBRL XML"],
            ["manual", "Manual Wizard"],
          ] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </details>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-start gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Upload Capitaline Data</h2>
            <p className="text-sm text-slate-500 mt-1">ZIP file containing Balance Sheet, P&amp;L &amp; Cash Flow .xls exports</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleLoadSample} className="text-sm px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium">
              Load VST Sample (10Y)
            </button>
          </div>
        </div>

        {/* Config row — Essential (always visible) */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company ID</label>
            <input value={companyId} onChange={(e) => setCompanyId(e.target.value.toUpperCase())}
              className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" placeholder="VST" />
          </div>
          <div>
            <label className={`block text-xs font-semibold mb-1 ${typeNotSelected ? "text-red-600" : "text-slate-600"}`}>
              Company Type{typeNotSelected && <span className="ml-1 text-red-600">⛔ required</span>}
            </label>
            <select
              value={config.company_type ?? "auto"}
              onChange={(e) => onConfigChange({
                ...config,
                company_type: e.target.value as EngineConfig["company_type"],
              })}
              className={`px-3 py-1.5 border rounded-lg text-sm bg-white ${
                typeNotSelected
                  ? "border-red-400 ring-1 ring-red-400"
                  : "border-slate-300"
              }`}
            >
              <option value="auto" disabled>— Select type —</option>
              <option value="bank">Bank</option>
              <option value="nbfc">NBFC</option>
              <option value="insurance">Insurance</option>
              <option value="industrial">Industrial</option>
              <option value="it-services">IT Services</option>
              <option value="consumer">Consumer / FMCG</option>
              <option value="utility">Utility / PSU</option>
              <option value="telecom">Telecom</option>
              <option value="cyclical">Cyclical / Metals</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Market Price ₹</label>
            <input
              type="number"
              step={0.01}
              value={config.market_price ?? ""}
              onChange={(e) => {
                const value = e.target.value.trim();
                onConfigChange({ ...config, market_price: value ? Number(value) : undefined });
              }}
              className="w-28 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
              placeholder="₹"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Shares (Cr)</label>
            <input
              type="number"
              step={0.01}
              value={config.shares_outstanding ?? ""}
              onChange={(e) => {
                const value = e.target.value.trim();
                onConfigChange({ ...config, shares_outstanding: value ? Number(value) : undefined });
              }}
              className="w-28 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
              placeholder="auto if blank"
            />
          </div>
        </div>

        {/* Fix 10: Config validation warnings — shown inline below essential fields */}
        {configWarnings.length > 0 && (
          <div className="mx-6 mb-2 space-y-1">
            {configWarnings.map((w, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                  w.severity === "error"
                    ? "bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300"
                    : "bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300"
                }`}
              >
                <span className="mt-0.5 shrink-0">{w.severity === "error" ? "⛔" : "⚠️"}</span>
                <span><b>{w.field}:</b> {w.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Collapsible: Advanced Config */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => setShowAdvancedConfig(!showAdvancedConfig)}
            className="w-full px-6 py-2.5 flex items-center justify-between text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <span>▸ Advanced Configuration (sector, market data, tax)</span>
            <span className="text-slate-400">{showAdvancedConfig ? "▾" : "▸"}</span>
          </button>
          {showAdvancedConfig && (
            <div className="px-6 py-4 bg-slate-50 flex flex-wrap gap-4 items-end border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Market Symbol</label>
                <input
                  value={config.market_data_symbol ?? config.ticker ?? ""}
                  onChange={(e) => onConfigChange({ ...config, market_data_symbol: e.target.value.toUpperCase().trim() || undefined })}
                  className="w-36 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                  placeholder="ASIANPAINT.BSE"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">DCF Sector Template</label>
                <select
                  value={config.sector_template ?? "auto"}
                  onChange={(e) => onConfigChange({
                    ...config,
                    sector_template: e.target.value as EngineConfig["sector_template"],
                  })}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="auto" disabled>— Select type —</option>
                  <option value="consumer-staples">Consumer staples</option>
                  <option value="paint">Paint / coatings</option>
                  <option value="industrials">Industrials</option>
                  <option value="commodities">Commodities</option>
                  <option value="retail">Retail</option>
                  <option value="services">Services</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Market Data Mode</label>
                <select
                  value={config.market_data_provider ?? "manual"}
                  onChange={(e) => onConfigChange({
                    ...config,
                    market_data_provider: e.target.value as EngineConfig["market_data_provider"],
                  })}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="manual">Manual / Fallback</option>
                  <option value="upstox-readonly">Upstox Read-only</option>
                  <option value="alphavantage">Alpha Vantage</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              {(config.market_data_provider ?? "manual") === "upstox-readonly" && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Upstox Instrument Key</label>
                  <input
                    value={config.market_data_instrument_key ?? ""}
                    onChange={(e) => onConfigChange({ ...config, market_data_instrument_key: e.target.value.trim() || undefined })}
                    className="w-52 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                    placeholder="NSE_EQ|INE021A01026"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Risk-Free Rate %</label>
                <input type="number" step={0.5} value={(config.risk_free_rate * 100).toFixed(1)}
                  onChange={(e) => onConfigChange({ ...config, risk_free_rate: Number(e.target.value) / 100 })}
                  className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tax Rate Mode</label>
                <select value={config.tax_rate_mode}
                  onChange={(e) => onConfigChange({ ...config, tax_rate_mode: e.target.value as "effective" | "statutory" })}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                  <option value="effective">Effective</option>
                  <option value="statutory">Statutory (25.17%)</option>
                </select>
              </div>
              <div className="flex gap-3 flex-wrap items-center">
                {[
                  { key: "oci_treated_as_unusual" as const, label: "OCI = Unusual" },
                  { key: "financial_institution_mode" as const, label: "Fin Institution (blocked)" },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={config[key] as boolean}
                      onChange={(e) => onConfigChange({ ...config, [key]: e.target.checked })}
                      className="rounded" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Collapsible: Cost of Capital */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => setShowCostOfCapital(!showCostOfCapital)}
            className="w-full px-6 py-2.5 flex items-center justify-between text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
          >
            <span>▸ Cost of Capital (ke, kd, WACC)</span>
            <span className="text-blue-400">{showCostOfCapital ? "▾" : "▸"}</span>
          </button>
          {showCostOfCapital && (
          <div className="px-6 py-3 bg-blue-50 flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-blue-700 mb-1">
                ke — Cost of Equity %
                <span className="text-blue-400 ml-1">(0 = use rf+erp)</span>
              </label>
              <input type="number" step={0.5} min={0} max={50}
                value={config.ke > 0 ? (config.ke * 100).toFixed(1) : ""}
                placeholder={`${((config.risk_free_rate + config.equity_risk_premium) * 100).toFixed(1)}`}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onConfigChange({ ...config, ke: v > 0 ? v / 100 : 0 });
                }}
                className="w-28 px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-blue-700 mb-1">kd pre-tax %</label>
              <input type="number" step={0.25} min={0} max={30}
                value={(config.kd_pretax * 100).toFixed(2)}
                onChange={(e) => onConfigChange({ ...config, kd_pretax: Number(e.target.value) / 100 })}
                className="w-28 px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-blue-700 mb-1">Tax rate for kd %</label>
              <input type="number" step={0.5} min={0} max={50}
                value={(config.tax_rate_for_kd * 100).toFixed(2)}
                onChange={(e) => onConfigChange({ ...config, tax_rate_for_kd: Number(e.target.value) / 100 })}
                className="w-28 px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white" />
            </div>
            <div className="text-xs text-blue-600 bg-white rounded-lg border border-blue-200 px-3 py-2">
              kd after-tax = kd_pretax × (1 − τ_kd)<br />
              = <b>{((config.kd_pretax * (1 - config.tax_rate_for_kd)) * 100).toFixed(2)}%</b>
              &nbsp;(computed, not stored)
            </div>
          </div>
          )}
        </div>

        {mode === "capitaline" && (
          <div className="m-6 space-y-4">
            {!uploadedFile ? (<>
              {/* Slot 1: Consolidated ZIP — REQUIRED */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">1</span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Consolidated Financial Data</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Required</span>
                </div>
                <p className="text-xs text-slate-500 ml-7">ZIP containing Balance Sheet + P&amp;L + Cash Flow .xls exports</p>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all relative overflow-hidden group ${
                  typeNotSelected
                    ? "border-red-300 bg-red-50/30 dark:bg-red-950/10 cursor-not-allowed opacity-60"
                    : dragOver
                    ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20 shadow-inner cursor-pointer"
                    : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/40 hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-sm cursor-pointer"
                }`}
              >
                <input 
                  type="file" 
                  accept=".zip" 
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      trace("ui", "upload:consZipSelected", { fileName: f.name, size: f.size });
                      // If standalone was pre-loaded, parse it first
                      let stanPeriods: RawPeriodData[] | null = null;
                      if (standaloneFile) {
                        stanPeriods = await parseStandaloneZip(standaloneFile);
                      }
                      // Validate quality sidecar if present (result stored for future pipeline wiring)
                      if (qualitySidecarFile) {
                        await parseQualitySidecar(qualitySidecarFile);
                      }
                      await processZip(f, undefined, stanPeriods);
                    }
                    e.target.value = "";
                  }}
                  className="hidden" 
                  id="zip-upload" 
                  disabled={isProcessing} 
                />
                <label htmlFor="zip-upload" className="cursor-pointer flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <svg className="w-6 h-6 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Drop consolidated ZIP or click to browse</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      BS + P&amp;L + CF in one .zip — we align them automatically
                    </p>
                  </div>
                </label>
              </div>

              {/* Slot 2: Standalone ZIP — optional */}
              <div className="space-y-1 pt-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-400 text-white text-[10px] font-bold">2</span>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Standalone Statements</span>
                  <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Optional</span>
                </div>
                <p className="text-xs text-slate-500 ml-7">Enables subsidiary contribution gap analysis (consolidated − standalone)</p>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOverStandalone(true); }}
                onDragLeave={() => setDragOverStandalone(false)}
                onDrop={async (e) => {
                  e.preventDefault(); setDragOverStandalone(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f && f.name.toLowerCase().endsWith(".zip")) {
                    trace("ui", "upload:standaloneDropped", { fileName: f.name });
                    setStandaloneFile(f);
                  }
                }}
                className={`border border-dashed rounded-xl p-4 transition-all ${
                  standaloneFile
                    ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20"
                    : dragOverStandalone
                    ? "border-indigo-400 bg-indigo-50/30"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/20 hover:border-slate-300"
                }`}
              >
                {standaloneFile ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-600">✓</span>
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{standaloneFile.name}</span>
                      <span className="text-[10px] text-slate-400">{(standaloneFile.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <button onClick={() => { setStandaloneFile(null); trace("ui", "upload:standaloneClear"); }} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                  </div>
                ) : (
                  <label className="cursor-pointer flex items-center gap-3">
                    <input
                      type="file"
                      accept=".zip"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { setStandaloneFile(f); trace("ui", "upload:standaloneSelected", { fileName: f.name }); }
                        e.target.value = "";
                      }}
                      className="hidden"
                      id="standalone-upload"
                    />
                    <label htmlFor="standalone-upload" className="cursor-pointer flex items-center gap-3 w-full">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                      <span className="text-xs text-slate-500">Drop standalone ZIP here or click</span>
                    </label>
                  </label>
                )}
              </div>

              {/* Slot 3: Quality Sidecar — only for bank/nbfc/insurance */}
              {(config.company_type === "bank" || config.company_type === "nbfc" || config.company_type === "insurance") && (
                <>
                  <div className="space-y-1 pt-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-400 text-white text-[10px] font-bold">3</span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Quality Indicators Sidecar</span>
                      <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Optional</span>
                    </div>
                    <p className="text-xs text-slate-500 ml-7">JSON with NIM, GNPA, CRAR, Cost/Income — enables bank quality panels</p>
                  </div>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOverQuality(true); }}
                    onDragLeave={() => setDragOverQuality(false)}
                    onDrop={async (e) => {
                      e.preventDefault(); setDragOverQuality(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f && f.name.toLowerCase().endsWith(".json")) {
                        trace("ui", "upload:qualityDropped", { fileName: f.name });
                        setQualitySidecarFile(f);
                      }
                    }}
                    className={`border border-dashed rounded-xl p-4 transition-all ${
                      qualitySidecarFile
                        ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20"
                        : dragOverQuality
                        ? "border-blue-400 bg-blue-50/30"
                        : "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/20 hover:border-slate-300"
                    }`}
                  >
                    {qualitySidecarFile ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600">✓</span>
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{qualitySidecarFile.name}</span>
                          <span className="text-[10px] text-slate-400">{(qualitySidecarFile.size / 1024).toFixed(0)} KB</span>
                        </div>
                        <button onClick={() => { setQualitySidecarFile(null); trace("ui", "upload:qualityClear"); }} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                      </div>
                    ) : (
                      <label className="cursor-pointer flex items-center gap-3">
                        <input
                          type="file"
                          accept=".json"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) { setQualitySidecarFile(f); trace("ui", "upload:qualitySelected", { fileName: f.name }); }
                            e.target.value = "";
                          }}
                          className="hidden"
                          id="quality-upload"
                        />
                        <label htmlFor="quality-upload" className="cursor-pointer flex items-center gap-3 w-full">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </div>
                          <span className="text-xs text-slate-500">Drop quality_indicators.json here or click</span>
                        </label>
                      </label>
                    )}
                  </div>
                </>
              )}

              {/* Coverage summary */}
              <div className="flex items-center gap-3 pt-2 pb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ready:</span>
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                  {!typeNotSelected ? "✓ Type" : "✗ Type"}
                </span>
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                  {standaloneFile ? "✓ Standalone" : "– Standalone"}
                </span>
                {(config.company_type === "bank" || config.company_type === "nbfc" || config.company_type === "insurance") && (
                  <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                    {qualitySidecarFile ? "✓ Quality" : "– Quality"}
                  </span>
                )}
              </div>

              {/* How to prepare — collapsed */}
              <details className="rounded-lg border border-slate-100 dark:border-slate-800">
                <summary className="px-3 py-2 cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 select-none">
                  How to prepare the Capitaline ZIP
                </summary>
                <div className="px-3 pb-3 text-xs text-slate-600 space-y-1.5">
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Export <b>Balance Sheet (Ind AS Detailed)</b> as XLS → filename must contain "balance"</li>
                    <li>Export <b>Profit &amp; Loss (Ind AS Detailed)</b> as XLS → filename must contain "profit" or "pnl"</li>
                    <li>Export <b>Cash Flow</b> as XLS → filename must contain "cash"</li>
                    <li>Select all three → <b>Add to ZIP</b> → upload above</li>
                  </ol>
                  <p className="text-slate-400 mt-1">Do not mix Consolidated and Standalone files in the same ZIP.</p>
                </div>
              </details>
            </>) : (
              <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6">
                {/* File Details Grid */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 flex items-center justify-center shrink-0">
                      <svg className="w-6 h-6 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 dark:text-slate-100 truncate max-w-xs sm:max-w-md" title={uploadedFile.name}>
                        {uploadedFile.name}
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">
                        {(uploadedFile.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => { setUploadedFile(null); setUploadStep("idle"); setError(""); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
                    >
                      Clear &amp; Start Over
                    </button>
                  </div>
                </div>

                {/* Progress Timeline Stepper */}
                <div className="relative pt-2">
                  <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-200 dark:bg-slate-800 -translate-y-1/2 z-0" />
                  
                  {/* Stepper items container */}
                  <div className="relative z-10 flex justify-between">
                    {[
                      { step: "unzipping", label: "Extracting Files", desc: "Decompressing XLS ZIP contents" },
                      { step: "parsing", label: "Reading Formats", desc: "Mapping sheets and columns" },
                      { step: "reconciling", label: "Balancing NOA/NFO", desc: "Aligning asset & liability lines" },
                      { step: "done", label: "Dataset Ready", desc: "Pipeline compilation finalized" }
                    ].map((item, idx) => {
                      const isCompleted = 
                        (item.step === "unzipping" && ["parsing", "success"].includes(uploadStep)) ||
                        (item.step === "parsing" && ["success"].includes(uploadStep)) ||
                        (item.step === "reconciling" && ["success"].includes(uploadStep)) ||
                        (item.step === "done" && uploadStep === "success");

                      const isActive = 
                        (item.step === "unzipping" && uploadStep === "unzipping") ||
                        (item.step === "parsing" && uploadStep === "parsing") ||
                        (item.step === "reconciling" && uploadStep === "parsing" && isProcessing) ||
                        (item.step === "done" && uploadStep === "parsing" && !isProcessing);

                      const isFailed = uploadStep === "failed";

                      return (
                        <div key={item.step} className="flex flex-col items-center text-center max-w-[120px] sm:max-w-[160px]">
                          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                            isCompleted 
                              ? "bg-emerald-500 border-emerald-500 text-white" 
                              : isActive 
                              ? "bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none animate-pulse scale-110" 
                              : isFailed && idx === 3
                              ? "bg-red-500 border-red-500 text-white"
                              : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-600"
                          }`}>
                            {isCompleted ? (
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : isFailed && idx === 3 ? (
                              "✕"
                            ) : (
                              idx + 1
                            )}
                          </div>
                          <div className="mt-2">
                            <div className={`text-xs font-bold ${isActive ? "text-indigo-600 dark:text-indigo-400" : isCompleted ? "text-emerald-600 dark:text-emerald-500" : "text-slate-700 dark:text-slate-300"}`}>
                              {item.label}
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug hidden sm:block">
                              {item.desc}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Status Notice Banners */}
                {uploadStep === "success" && (
                  <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 rounded-xl p-4 flex items-center gap-3">
                    <span className="text-xl">🎉</span>
                    <div className="text-xs text-emerald-800 dark:text-emerald-400 font-medium">
                      Excellent! <b>{uploadedFile.name}</b> was ingested successfully. The financial engine has aligned the balance sheets, reformulated operating cash flows, and generated your valuation models.
                    </div>
                  </div>
                )}

                {uploadStep === "failed" && (
                  <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-xl p-4 flex items-center gap-3">
                    <span className="text-xl">⚠️</span>
                    <div className="text-xs text-red-800 dark:text-red-400 font-medium space-y-1">
                      <div><b>Ingestion Failed:</b> Please review the spreadsheet formats inside your ZIP.</div>
                      {error && <div className="font-mono bg-red-100/50 dark:bg-red-950/40 p-1.5 rounded mt-1 border border-red-200/50">{error}</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mode === "screener" && (
          <div className="m-6 space-y-3">
            <p className="text-xs text-slate-500">Paste Screener.in tab-delimited 10Y table (copied from browser).</p>
            <textarea value={screenerText} onChange={(e) => setScreenerText(e.target.value)} className="w-full h-48 p-3 border rounded-lg font-mono text-xs" placeholder="Metric\t2016\t2017 ..." />
            <button
              onClick={() => {
                try {
                  const meta = buildMeta("screener");
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "run-started",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      ingestionMode: "screener",
                    },
                  });
                  const { periods, diagnostics } = parseScreenerTabDelimitedDetailed(screenerText, { companyId });
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "text-input-ingested",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      sourceText: screenerText,
                      periodCount: periods.length,
                      parserDiagnostics: diagnostics,
                    },
                  });
                  if (!periods.length) setError("Screener parse returned 0 periods.");
                  else onDataSubmit(periods, undefined, meta, diagnostics);
                } catch (e) {
                  const meta = buildMeta("screener");
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "input-ingest-failed",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      error: e instanceof Error ? e.message : String(e),
                    },
                  });
                  setError(`Screener parse failed: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              Parse Screener Data
            </button>
          </div>
        )}

        {mode === "json" && (
          <div className="m-6 space-y-3">
            <p className="text-xs text-slate-500">Paste RawPeriodData[] JSON for direct API ingestion.</p>
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} className="w-full h-48 p-3 border rounded-lg font-mono text-xs" placeholder='[{"company_id":"...","period_end":"2025-03-31","raw_metric_values":{...}}]' />
            <button
              onClick={() => {
                try {
                  const meta = buildMeta("json");
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "run-started",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      ingestionMode: "json",
                    },
                  });
                  const { periods, diagnostics } = parseRawPeriodsJsonDetailed(jsonText);
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "json-input-ingested",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      sourceJson: jsonText,
                      periodCount: periods.length,
                      parserDiagnostics: diagnostics,
                    },
                  });
                  onDataSubmit(periods, undefined, meta, diagnostics);
                } catch (e) {
                  const meta = buildMeta("json");
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "input-ingest-failed",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      error: e instanceof Error ? e.message : String(e),
                    },
                  });
                  setError(`JSON ingestion failed: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              Parse JSON Data
            </button>
          </div>
        )}

        {mode === "xbrl" && (
          <div className="m-6 space-y-3">
            <p className="text-xs text-slate-500">Upload MCA iXBRL / XBRL XML file (best-effort parser with canonical mapping).</p>
            <input
              type="file"
              accept=".xml,.xbrl,.txt"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const meta = buildMeta("xbrl", { fileName: f.name });
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "run-started",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      fileName: f.name,
                      ingestionMode: "xbrl",
                    },
                  });
                  const txt = await f.text();
                  const { periods, diagnostics } = parseXbrlXmlDetailed(txt, companyId);
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "xbrl-input-ingested",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      fileName: f.name,
                      sourceXml: txt,
                      periodCount: periods.length,
                      parserDiagnostics: diagnostics,
                    },
                  });
                  if (!periods.length) setError("XBRL parse returned 0 periods. Check taxonomy labels/contexts.");
                  else onDataSubmit(periods, undefined, meta, diagnostics);
                } catch (err) {
                  const meta = buildMeta("xbrl", { fileName: f.name });
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "input-ingest-failed",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      fileName: f.name,
                      error: err instanceof Error ? err.message : String(err),
                    },
                  });
                  setError(`XBRL parse failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              className="block w-full text-sm border border-slate-300 rounded-lg p-2 bg-white"
            />
          </div>
        )}

        {mode === "manual" && (
          <div className="m-6">
            <ManualEntryWizard
              onSubmit={(rows) => {
                const meta = buildMeta("manual");
                void persistAuditEvent({
                  runId: meta.runId,
                  eventType: "run-started",
                  companyId: meta.companyId,
                  sourceMode: meta.sourceMode,
                  payload: {
                    ingestionMode: "manual",
                  },
                });
                void persistAuditEvent({
                  runId: meta.runId,
                  eventType: "manual-input-ingested",
                  companyId: meta.companyId,
                  sourceMode: meta.sourceMode,
                  payload: {
                    rows,
                    periodCount: rows.length,
                    parserDiagnostics: diagnoseManualRawPeriods(rows),
                  },
                });
                onDataSubmit(rows, undefined, meta, diagnoseManualRawPeriods(rows));
              }}
            />
          </div>
        )}

        {error && (
          <div className="mx-6 mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}
        {currentData && currentData.length > 0 && (
          <div className="mx-6 mb-6 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
            ✓ <strong>{currentData.length}</strong> periods loaded for <strong>{currentData[0]?.company_id}</strong>.{" "}
            {currentData.map((d) => d.period_end.slice(0, 7)).join(", ")}
          </div>
        )}
      </div>

      {/* Config summary removed — raw dump moved to Debug tab. 
           Editable fields are in Advanced Config + Cost of Capital collapsibles above. */}
    </div>
  );
}
