import { useState, useCallback } from "react";
import { RawPeriodData, EngineConfig } from "../engine/types";
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
import ManualEntryWizard from "./ManualEntryWizard";
import OnboardingCard from "./dashboard/OnboardingCard";
import CompanyLibraryGrid from "./data-entry/CompanyLibraryGrid";
import { resolveNseSymbol } from "../engine/nseSymbolRegistry";

interface Props {
  onDataSubmit: (data: RawPeriodData[], debug?: CapitalineParseDebug, meta?: AuditSubmissionMeta, parserDiagnostics?: SourceParserDiagnostics | null, segmentData?: import("../engine/segmentParser").SegmentData | null) => void;
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
  const auditGovernance = getAuditClientGovernance();

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

  const processZip = useCallback(async (file: File, overrideCompanyId?: string) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Please upload a .zip file containing Capitaline XLS exports.");
      setUploadStep("failed");
      return;
    }
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
      onDataSubmit(periods, debug, meta, null, segmentData);
      if (periods.length === 0) {
        setError("Parsed 0 periods. Check Debug tab for details.");
        setUploadStep("failed");
      } else {
        setUploadStep("success");
      }
    } catch (err: unknown) {
      await persistAuditEvent({
        runId: meta.runId,
        eventType: "input-ingest-failed",
        companyId: meta.companyId,
        sourceMode: meta.sourceMode,
        payload: {
          fileName: file.name,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      setError(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      setUploadStep("failed");
    } finally { setIsProcessing(false); }
  }, [auditGovernance.maximumUploadBytes, buildMeta, companyId, onDataSubmit]);

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
            onPickCompany={async (folder, ticker, type, scope) => {
              try {
                setIsProcessing(true); setError("");
                
                // Wire chosen company parameters directly to the engine configuration
                onConfigChange({
                  ...config,
                  quality_data_folder: folder,
                  market_data_symbol: ticker,
                  ticker: ticker,
                  company_type: type === "bank" || type === "nbfc" || type === "insurance" ? type : "auto",
                });

                const zipName = scope === "standalone" ? "standalone.zip" : `${folder}.zip`;
                const zipUrl = `/data/companies/${encodeURIComponent(folder)}/${encodeURIComponent(zipName)}`;
                const resp = await fetch(zipUrl);
                if (!resp.ok) throw new Error(`Library ${scope} ZIP not found for "${folder}".`);
                const blob = await resp.blob();
                const file = new File([blob], zipName, { type: "application/zip" });
                setCompanyId(ticker.toUpperCase().slice(0, 20));
                await processZip(file, ticker.toUpperCase().slice(0, 20));
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

      <div className="bg-white rounded-xl border border-slate-200 p-2 inline-flex gap-2">
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            {lbl}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-start gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Upload Capitaline Data</h2>
            <p className="text-sm text-slate-500 mt-1">ZIP file containing Balance Sheet, P&amp;L &amp; Cash Flow .xls exports</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Phase I10 — Load from library dropdown */}
            <select
              className="text-sm px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-100 font-medium"
              defaultValue=""
                onChange={async (e) => {
                    const folder = e.target.value;
                    if (!folder) return;
                    e.target.value = "";
                    try {
                        setIsProcessing(true); setError("");
                        // Resolve NSE ticker and wire config before processing
                        const ticker = resolveNseSymbol(folder) ?? folder.toUpperCase().replace(/\s+/g, "");
                        onConfigChange({
                            ...config,
                            quality_data_folder: folder,
                            market_data_symbol: ticker,
                            ticker: ticker,
                        });
                        const zipUrl = `/data/companies/${encodeURIComponent(folder)}/${encodeURIComponent(folder)}.zip`;
                        const resp = await fetch(zipUrl);
                        if (!resp.ok) throw new Error(`Library ZIP not found for "${folder}". Upload the file manually.`);
                        const blob = await resp.blob();
                        const file = new File([blob], `${folder}.zip`, { type: "application/zip" });
                        setCompanyId(ticker.toUpperCase().slice(0, 20));
                        await processZip(file, ticker.toUpperCase().slice(0, 20));
                    } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                        setIsProcessing(false);
                    }
                }}
            >
              <option value="">📂 Load from library…</option>
              {[
                "ITC",
                "HDFC bank",
                "ICICI bank",
                "bajaj finance",
                "Life Insurance Corporation of India",
                "paytm",
                "Power Grid Corporation of India Ltd",
                "reliance Industries",
                "Tata Consultancy Services Ltd",
                "Tata steel",
                "Vodafone Idea Ltd",
              ].map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
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
            <label className="block text-xs font-medium text-slate-600 mb-1">Company Type</label>
            <select
              value={config.company_type ?? "auto"}
              onChange={(e) => onConfigChange({
                ...config,
                company_type: e.target.value as EngineConfig["company_type"],
              })}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="auto">Auto detect</option>
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
                  <option value="auto">Auto detect</option>
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
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer relative overflow-hidden group ${
                  dragOver 
                    ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20 shadow-inner" 
                    : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/40 hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-sm"
                }`}
              >
                <input 
                  type="file" 
                  accept=".zip" 
                  onChange={async (e) => { const f = e.target.files?.[0]; if (f) await processZip(f); e.target.value = ""; }}
                  className="hidden" 
                  id="zip-upload" 
                  disabled={isProcessing} 
                />
                <label htmlFor="zip-upload" className="cursor-pointer flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
                    <svg className="w-8 h-8 text-indigo-500 dark:text-indigo-400 group-hover:bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-base">Drop Capitaline ZIP here or click to browse</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                      Pack your Balance Sheet, P&amp;L, and Cash Flow <b>.xls exports</b> into a single .zip file. We'll unzip and align them automatically.
                    </p>
                  </div>
                </label>
              </div>

              {/* Warning Alert about Scope Contamination */}
              <div className="mt-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-xl p-3.5 flex items-start gap-3">
                <span className="text-base shrink-0 select-none">⚠️</span>
                <div className="text-xs text-amber-800 dark:text-amber-300 leading-normal text-left">
                  <span className="font-bold">Important Scope Warning:</span> Do not mix Consolidated and Standalone files in the same custom ZIP. Because metrics use the same sheet structures, combining them will trigger naming collisions and overwrite your financial data. Upload separate ZIPs for each reporting scope.
                </div>
              </div>
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

      {/* Config summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 text-sm space-y-2">
        <h3 className="font-semibold text-slate-800">Engine Configuration (§10.2)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {Object.entries(config).map(([k, v]) => (
            <div key={k} className="bg-slate-50 rounded p-2">
              <div className="text-slate-400 font-mono">{k}</div>
              <div className="font-semibold text-slate-700 truncate">{String(v)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 text-sm text-slate-600 space-y-2">
        <h3 className="font-semibold text-slate-800">How to prepare the Capitaline ZIP</h3>
        <ol className="list-decimal pl-4 space-y-1.5">
          <li>Export <strong>Balance Sheet (Ind AS Detailed)</strong> as XLS → filename must contain "balance"</li>
          <li>Export <strong>Profit &amp; Loss (Ind AS Detailed)</strong> as XLS → filename must contain "profit" or "pnl"</li>
          <li>Export <strong>Cash Flow</strong> as XLS → filename must contain "cash"</li>
          <li>Select all three → <strong>Add to ZIP</strong> → upload above</li>
        </ol>
        <p className="text-slate-400 text-xs mt-2">Default config = DEFAULT_CONFIG per §10.2 of the design specification.</p>
      </div>
    </div>
  );
}
