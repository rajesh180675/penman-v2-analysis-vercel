import { useState, useCallback } from "react";
import { RawPeriodData, EngineConfig } from "../engine/types";
import { parseCapitalineZip, CapitalineParseDebug } from "../engine/capitalineParser";
import { parseScreenerTabDelimited } from "../engine/screenerParser";
import { parseRawPeriodsJson } from "../engine/jsonIngestion";
import { parseXbrlXml } from "../engine/xbrlParser";
import { AuditSubmissionMeta, createAuditRunId, persistAuditEvent, persistAuditFile } from "../lib/audit";
import ManualEntryWizard from "./ManualEntryWizard";

interface Props {
  onDataSubmit: (data: RawPeriodData[], debug?: CapitalineParseDebug, meta?: AuditSubmissionMeta) => void;
  currentData: RawPeriodData[] | null;
  config: EngineConfig;
  onConfigChange: (cfg: EngineConfig) => void;
}

export default function DataEntry({ onDataSubmit, currentData, config, onConfigChange }: Props) {
  const [mode, setMode] = useState<"capitaline" | "screener" | "json" | "xbrl" | "manual">("capitaline");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError]     = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [companyId, setCompanyId] = useState("VST");
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [screenerText, setScreenerText] = useState("");
  const [jsonText, setJsonText] = useState("");

  const buildMeta = useCallback(
    (sourceMode: AuditSubmissionMeta["sourceMode"], overrides?: Partial<AuditSubmissionMeta>): AuditSubmissionMeta => ({
      runId: overrides?.runId ?? createAuditRunId(),
      sourceMode,
      companyId: overrides?.companyId ?? companyId,
      fileName: overrides?.fileName ?? null,
    }),
    [companyId]
  );

  const processZip = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Please upload a .zip file containing Capitaline XLS exports.");
      return;
    }
    setIsProcessing(true); setError(""); setLastFile(file.name);
    const meta = buildMeta("capitaline", { fileName: file.name });
    try {
      await persistAuditFile({
        runId: meta.runId,
        kind: "inputs",
        eventType: "input-file-uploaded",
        file,
        filename: file.name,
        companyId: meta.companyId,
        sourceMode: meta.sourceMode,
      });
      const { periods, debug } = await parseCapitalineZip(file, { companyId });
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
      onDataSubmit(periods, debug, meta);
      if (periods.length === 0) setError("Parsed 0 periods. Check Debug tab for details.");
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
    } finally { setIsProcessing(false); }
  }, [buildMeta, companyId, onDataSubmit]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processZip(file);
  };

  const handleLoadSample = () => {
    const meta = buildMeta("sample", { fileName: "embedded-vst-sample" });
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
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Upload Capitaline Data</h2>
            <p className="text-sm text-slate-500 mt-1">ZIP file containing Balance Sheet, P&L &amp; Cash Flow .xls exports</p>
          </div>
          <button onClick={handleLoadSample} className="text-sm px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium">
            Load VST Sample (10Y)
          </button>
        </div>

        {/* Config row — Basic */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company ID</label>
            <input value={companyId} onChange={(e) => setCompanyId(e.target.value.toUpperCase())}
              className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" placeholder="VST" />
          </div>
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
              { key: "financial_institution_mode" as const, label: "Fin Institution" },
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

        {/* Config row — Cost of Capital (S-9.4: ke, kd_pretax, tax_rate_for_kd; kw is NEVER a direct input) */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex flex-wrap gap-4 items-end">
          <div className="text-xs font-semibold text-blue-700 w-full mb-1">
            Cost of Capital (S-9.4) — kw is derived automatically; never a direct input
          </div>
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

        {mode === "capitaline" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`m-6 border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
              dragOver ? "border-indigo-400 bg-indigo-50"
              : isProcessing ? "border-slate-200 bg-slate-50"
              : "border-slate-300 bg-white hover:border-indigo-300"
            }`}
          >
            <input type="file" accept=".zip" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await processZip(f); e.target.value = ""; }}
              className="hidden" id="zip-upload" disabled={isProcessing} />
            <label htmlFor="zip-upload" className="cursor-pointer flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center">
                {isProcessing ? (
                  <svg className="w-7 h-7 text-indigo-600 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-7 h-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                )}
              </div>
              <div>
                <div className="font-semibold text-slate-700">{isProcessing ? "Processing…" : "Drop ZIP here or click to browse"}</div>
                <div className="text-xs text-slate-500 mt-0.5">{lastFile ? `Last: ${lastFile}` : "Capitaline XLS exports bundled in a .zip"}</div>
              </div>
            </label>
          </div>
        )}

        {mode === "screener" && (
          <div className="m-6 space-y-3">
            <p className="text-xs text-slate-500">Paste Screener.in tab-delimited 10Y table (copied from browser).</p>
            <textarea value={screenerText} onChange={(e) => setScreenerText(e.target.value)} className="w-full h-48 p-3 border rounded-lg font-mono text-xs" placeholder="Metric\t2016\t2017 ..." />
            <button
              onClick={() => {
                try {
                  const periods = parseScreenerTabDelimited(screenerText, { companyId });
                  const meta = buildMeta("screener");
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "text-input-ingested",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      sourceText: screenerText,
                      periodCount: periods.length,
                    },
                  });
                  if (!periods.length) setError("Screener parse returned 0 periods.");
                  else onDataSubmit(periods, undefined, meta);
                } catch (e) {
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
                  const periods = parseRawPeriodsJson(jsonText);
                  const meta = buildMeta("json");
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "json-input-ingested",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      sourceJson: jsonText,
                      periodCount: periods.length,
                    },
                  });
                  onDataSubmit(periods, undefined, meta);
                } catch (e) {
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
                  const txt = await f.text();
                  const periods = parseXbrlXml(txt, companyId);
                  const meta = buildMeta("xbrl", { fileName: f.name });
                  void persistAuditEvent({
                    runId: meta.runId,
                    eventType: "xbrl-input-ingested",
                    companyId: meta.companyId,
                    sourceMode: meta.sourceMode,
                    payload: {
                      fileName: f.name,
                      sourceXml: txt,
                      periodCount: periods.length,
                    },
                  });
                  if (!periods.length) setError("XBRL parse returned 0 periods. Check taxonomy labels/contexts.");
                  else onDataSubmit(periods, undefined, meta);
                } catch (err) {
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
                  eventType: "manual-input-ingested",
                  companyId: meta.companyId,
                  sourceMode: meta.sourceMode,
                  payload: {
                    rows,
                    periodCount: rows.length,
                  },
                });
                onDataSubmit(rows, undefined, meta);
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
