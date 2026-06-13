import { useState, useCallback, useMemo } from "react";
import { RawPeriodData, EngineConfig, validateEngineConfig, CompanyRegistry } from "../engine/types";
import type { CapitalineParseDebug } from "../engine/capitalineParser";
import { SourceParserDiagnostics } from "../engine/parserDiagnostics";
import { runBatchAnalysis, type BatchCompanyInput } from "../engine/batchRunner";
import { LibraryCompany } from "./data-entry/companyRegistry";
import { rememberWorkspaceAnalysis } from "../lib/researchWorkspace";
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
import OnboardingCard from "./dashboard/OnboardingCard";
import CompanyLibraryGrid from "./data-entry/CompanyLibraryGrid";
import CompanyTypePickerModal from "./data-entry/CompanyTypePickerModal";
import ConfigSection from "./data-entry/ConfigSection";
import CapitalineUploadPanel from "./data-entry/CapitalineUploadPanel";
import SourceModePanels from "./data-entry/SourceModePanels";

interface Props {
  onDataSubmit: (
    data: RawPeriodData[],
    debug?: CapitalineParseDebug | undefined,
    meta?: AuditSubmissionMeta | undefined,
    parserDiagnostics?: SourceParserDiagnostics | null | undefined,
    segmentData?: import("../engine/segmentParser").AllSegmentData | null | undefined,
    // Phase A — optional standalone dataset for dual-scope (consolidated + standalone)
    // analysis. When present, App computes the gap (cons − stan = subsidiary
    // contribution). null when only consolidated was loaded.
    standaloneData?: RawPeriodData[] | null | undefined,
  ) => void;
  currentData: RawPeriodData[] | null;
  config: EngineConfig;
  onConfigChange: (cfg: EngineConfig) => void;
  onBatchSubmit?: ((registry: CompanyRegistry) => void) | undefined;
}

export default function DataEntry({ onDataSubmit, currentData, config, onConfigChange, onBatchSubmit }: Props) {
  const [mode, setMode] = useState<"capitaline" | "screener" | "json" | "xbrl" | "manual">("capitaline");
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: number } | null>(null);
  const [uploadStep, setUploadStep] = useState<"idle" | "unzipping" | "parsing" | "success" | "failed">("idle");
  const [error, setError]     = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [companyId, setCompanyId] = useState("VST");
  const [pendingPick, setPendingPick] = useState<{
    folder: string; ticker: string; type: string;
    scope: string; hasStandalone: boolean;
    blobUrl?: string | null | undefined; standaloneBlobUrl?: string | null | undefined;
    qualityIndicatorsBlobUrl?: string | null | undefined;
  } | null>(null);
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
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
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
    overrideCompanyId?: string | undefined,
    // Phase A — optional pre-parsed standalone periods. When the library card
    // loaded both consolidated + standalone, the caller parses standalone
    // first (so failures don't abort consolidated) and passes the periods here.
    standalonePeriods?: RawPeriodData[] | null | undefined,
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

  const handleBatchRun = useCallback(async (companies: LibraryCompany[]) => {
    if (!onBatchSubmit) return;
    const t0 = performance.now();
    trace("ui", "dataEntry:batchRun:start", { count: companies.length });
    setIsProcessing(true);
    setError("");
    setBatchStatus(`Running 0 / ${companies.length}`);
    try {
      const inputs: BatchCompanyInput[] = companies.map((c) => ({
        folder: c.folder,
        name: c.name,
        ticker: c.ticker,
        type: c.type as BatchCompanyInput["type"],
        sector: c.sector,
        hasStandalone: c.hasStandalone === true,
        blobUrl: c.blobUrl,
        standaloneBlobUrl: c.standaloneBlobUrl,
        qualityIndicatorsBlobUrl: c.qualityIndicatorsBlobUrl,
      }));
      const result = await runBatchAnalysis(inputs, config);
      if (result.summary.succeeded > 0) {
        for (const company of Object.values(result.registry.companies)) {
          setBatchStatus(`Saving ${company.label}...`);
          rememberWorkspaceAnalysis({
            rawData: company.rawData,
            recastData: company.recastData,
            config: { ...config, ticker: company.id, market_data_symbol: company.id, sector_template: undefined },
          });
        }
        onBatchSubmit(result.registry);
      }
      if (result.summary.failed > 0) {
        const samples = Object.entries(result.errors).slice(0, 5).map(([folder, msg]) => `${folder}: ${msg}`).join("; ");
        setError(`Batch finished with ${result.summary.failed} failure(s). ${samples}`);
      }
      trace("ui", "dataEntry:batchRun:complete", { ...result.summary, duration_ms: Math.round(performance.now() - t0) });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      trace("ui", "dataEntry:batchRun:error", { error: errMsg, stack: (err as Error)?.stack }, null, { level: "error" });
      setError(`Batch run failed: ${errMsg}`);
    } finally {
      setIsProcessing(false);
      setBatchStatus(null);
    }
  }, [config, onBatchSubmit]);

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
        <div className="card-base p-6">
          <CompanyLibraryGrid
            disabled={isProcessing}
            onPickCompany={(folder, ticker, type, scope, hasStandalone, blobUrl, standaloneBlobUrl, qualityIndicatorsBlobUrl) => {
              // Show type picker modal instead of loading immediately
              setPendingPick({ folder, ticker, type, scope, hasStandalone, blobUrl, standaloneBlobUrl, qualityIndicatorsBlobUrl });
            }}
            onBatchRun={onBatchSubmit ? handleBatchRun : undefined}
          />
          {batchStatus && (
            <div className="mt-3 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg px-3 py-2">
              {batchStatus}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-center">
            <p className="text-xs text-slate-500">
              Or scroll down to upload your own Capitaline ZIP, paste from Screener.in, or build manually.
            </p>
          </div>
        </div>
      )}

      {/* Company type picker modal */}
      <CompanyTypePickerModal
        company={pendingPick ? { folder: pendingPick.folder, ticker: pendingPick.ticker, type: pendingPick.type, hasStandalone: pendingPick.hasStandalone, blobUrl: pendingPick.blobUrl, standaloneBlobUrl: pendingPick.standaloneBlobUrl, qualityIndicatorsBlobUrl: pendingPick.qualityIndicatorsBlobUrl } : null}
        onCancel={() => setPendingPick(null)}
        onConfirm={async (company, chosenType) => {
          setPendingPick(null);
          const { folder, ticker } = company;
          const scope = pendingPick!.scope;
          const hasStandalone = company.hasStandalone;
          const blobUrl = company.blobUrl;
          const standaloneBlobUrl = company.standaloneBlobUrl;
          const qualityIndicatorsBlobUrl = company.qualityIndicatorsBlobUrl;
          try {
            setIsProcessing(true); setError("");

            // Wire user-chosen type directly — unconditional override
            onConfigChange({
              ...config,
              quality_data_folder: folder,
              quality_indicators_blob_url: qualityIndicatorsBlobUrl ?? null,
              market_data_symbol: ticker,
              market_data_provider: "nse",
              ticker: ticker,
              company_type: chosenType,
            });

            const useDualScope = scope === "consolidated" && hasStandalone === true;
            // In local dev, always use the local Vite-served paths — all ZIPs exist
            // under public/data/companies/ and blob URLs fail with CORS/network errors
            // in a localhost context. On Vercel (DEV=false) the blobUrl is used as normal.
            const preferLocal = import.meta.env.DEV;
            const encodePath = (s: string) => encodeURIComponent(s).replace(/%26/g, "&");
            const consolidatedUrl = (!preferLocal && blobUrl) ? blobUrl : `/data/companies/${encodePath(folder)}/${encodePath(folder)}.zip`;
            const standaloneUrl   = (!preferLocal && standaloneBlobUrl) ? standaloneBlobUrl : `/data/companies/${encodePath(folder)}/standalone.zip`;

            if (useDualScope) {
              const consResp = await fetch(consolidatedUrl);
              if (!consResp.ok) throw new Error(`Consolidated ZIP not found for "${folder}".`);
              const consBlob = await consResp.blob();
              const consFile = new File([consBlob], `${folder}.zip`, { type: "application/zip" });
              setCompanyId(ticker.toUpperCase().slice(0, 20));

              let standalonePeriods: RawPeriodData[] | null = null;
              try {
                const stanResp = await fetch(standaloneUrl);
                if (stanResp.ok) {
                  const stanBlob = await stanResp.blob();
                  const stanFile = new File([stanBlob], "standalone.zip", { type: "application/zip" });
                  const { parseCapitalineZip } = await import("../engine/capitalineParser");
                  const stanResult = await parseCapitalineZip(stanFile, { companyId: ticker.toUpperCase().slice(0, 20) });
                  standalonePeriods = stanResult.periods.length > 0 ? stanResult.periods : null;
                }
              } catch (stanErr) {
                const msg = stanErr instanceof Error ? stanErr.message : String(stanErr);
                trace("ui", "dataEntry:standaloneFailed", { folder, error: msg }, null, { level: "warn" });
              }
              await processZip(consFile, ticker.toUpperCase().slice(0, 20), standalonePeriods, { skipTypeCheck: true });
            } else {
              const zipName = scope === "standalone" ? "standalone.zip" : `${folder}.zip`;
              const zipUrl = scope === "standalone"
                ? ((!preferLocal && standaloneBlobUrl) ? standaloneBlobUrl : `/data/companies/${encodePath(folder)}/standalone.zip`)
                : ((!preferLocal && blobUrl) ? blobUrl : `/data/companies/${encodePath(folder)}/${encodePath(zipName)}`);
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

      <div className="card-base overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Upload Capitaline Data</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">ZIP file containing Balance Sheet, P&amp;L &amp; Cash Flow .xls exports</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleLoadSample} className="text-sm px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium">
              Load VST Sample (10Y)
            </button>
          </div>
        </div>

        <ConfigSection
          config={config}
          onConfigChange={onConfigChange}
          typeNotSelected={typeNotSelected}
          configWarnings={configWarnings}
          companyId={companyId}
          setCompanyId={setCompanyId}
          showAdvancedConfig={showAdvancedConfig}
          setShowAdvancedConfig={setShowAdvancedConfig}
          showCostOfCapital={showCostOfCapital}
          setShowCostOfCapital={setShowCostOfCapital}
        />

        {mode === "capitaline" && (
          <CapitalineUploadPanel
            config={config}
            typeNotSelected={typeNotSelected}
            isProcessing={isProcessing}
            error={error}
            uploadedFile={uploadedFile}
            setUploadedFile={setUploadedFile}
            uploadStep={uploadStep}
            setUploadStep={setUploadStep}
            setError={setError}
            dragOver={dragOver}
            setDragOver={setDragOver}
            handleDrop={handleDrop}
            standaloneFile={standaloneFile}
            setStandaloneFile={setStandaloneFile}
            dragOverStandalone={dragOverStandalone}
            setDragOverStandalone={setDragOverStandalone}
            qualitySidecarFile={qualitySidecarFile}
            setQualitySidecarFile={setQualitySidecarFile}
            dragOverQuality={dragOverQuality}
            setDragOverQuality={setDragOverQuality}
            parseStandaloneZip={parseStandaloneZip}
            parseQualitySidecar={parseQualitySidecar}
            processZip={processZip}
          />
        )}

        <SourceModePanels
          mode={mode}
          companyId={companyId}
          screenerText={screenerText}
          setScreenerText={setScreenerText}
          jsonText={jsonText}
          setJsonText={setJsonText}
          setError={setError}
          buildMeta={buildMeta}
          onDataSubmit={onDataSubmit}
        />

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
