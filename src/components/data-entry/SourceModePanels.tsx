import { RawPeriodData } from "../../engine/types";
import { parseScreenerTabDelimitedDetailed } from "../../engine/screenerParser";
import { parseRawPeriodsJsonDetailed } from "../../engine/jsonIngestion";
import { parseXbrlXmlDetailed } from "../../engine/xbrlParser";
import { diagnoseManualRawPeriods } from "../../engine/manualEntryParser";
import { SourceParserDiagnostics } from "../../engine/parserDiagnostics";
import { AuditSubmissionMeta, persistAuditEvent } from "../../lib/audit";
import type { CapitalineParseDebug } from "../../engine/capitalineParser";
import ManualEntryWizard from "../ManualEntryWizard";

interface Props {
  mode: "capitaline" | "screener" | "json" | "xbrl" | "manual";
  companyId: string;
  screenerText: string;
  setScreenerText: React.Dispatch<React.SetStateAction<string>>;
  jsonText: string;
  setJsonText: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  buildMeta: (
    sourceMode: AuditSubmissionMeta["sourceMode"],
    overrides?: Partial<AuditSubmissionMeta>,
  ) => AuditSubmissionMeta;
  onDataSubmit: (
    data: RawPeriodData[],
    debug?: CapitalineParseDebug | undefined,
    meta?: AuditSubmissionMeta | undefined,
    parserDiagnostics?: SourceParserDiagnostics | null | undefined,
    segmentData?: import("../../engine/segmentParser").AllSegmentData | null | undefined,
    standaloneData?: RawPeriodData[] | null | undefined,
  ) => void;
}

export default function SourceModePanels({
  mode,
  companyId,
  screenerText,
  setScreenerText,
  jsonText,
  setJsonText,
  setError,
  buildMeta,
  onDataSubmit,
}: Props) {
  return (
    <>
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
    </>
  );
}
