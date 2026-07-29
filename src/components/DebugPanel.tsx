import { useState, useMemo } from "react";
import { CapitalineParseDebug } from "../engine/capitalineParser";
import { RawPeriodData, RecastPeriod } from "../engine/types";
import type { GreenfieldPipelineResult } from "../engine/greenfieldPipeline";
import { auditMappingCoverage, evaluateGranularityChecklist, QualityGateReport } from "../engine/mappingAudit";
import { runIdentityAssertions } from "../engine/identityTests";
import { Card, StatBox } from "./debug/debugUi";
import { sha256HexString, hmacSha256Hex, escapeCsvCell } from "./debug/debugFormatters";
import { MappingAuditGrid } from "./debug/MappingAuditGrid";
import {
  ManifestVerifyPanel,
  type BundleManifest,
  type ManifestVerifyResult,
} from "./debug/ManifestVerifyPanel";
import { IdentitySuitePanel } from "./debug/IdentitySuitePanel";
import { TraceabilityPanel, type TraceRecord } from "./debug/TraceabilityPanel";
import { GranularityChecklistPanel } from "./debug/GranularityChecklistPanel";
import { RecastVerificationPanel } from "./debug/RecastVerificationPanel";
import { MetricSearchPanel, SEARCH_ROWS_SHOWN } from "./debug/MetricSearchPanel";
import { searchableBaseKeys } from "./debug/searchableKeys";
import { parsedKeyCensus, censusBasisNote } from "./debug/keyCensus";
import { RawGridDumps } from "./debug/RawGridDumps";
import { RawKeysGrid } from "./debug/RawKeysGrid";
import { TraceLogViewer } from "./debug/TraceLogViewer";
import { SourceLineageCard } from "./debug/SourceLineageCard";
import { GreenfieldPanel } from "./debug/GreenfieldPanel";

interface Props {
  debugInfo: CapitalineParseDebug | null;
  recastData?: RecastPeriod[] | null | undefined;
  rawData?: RawPeriodData[] | null | undefined;
  qualityGate?: QualityGateReport | null | undefined;
  engineError?: string | null | undefined;
  greenfield?: GreenfieldPipelineResult | null | undefined;
}

export default function DebugPanel({ debugInfo, recastData, rawData, qualityGate, engineError, greenfield }: Props) {
  const [expandedGrid, setExpandedGrid] = useState<string | null>(null);
  const [showAllKeys, setShowAllKeys]   = useState(false);
  const [showCollisions, setShowCollisions] = useState(false);
  const [showSample, setShowSample]     = useState(true);
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState<number>(0);
  const [metricSearch, setMetricSearch] = useState("");
  const [selectedTraceLine, setSelectedTraceLine] = useState<string>("");
  const [manifestFileName, setManifestFileName] = useState("");
  const [manifestObj, setManifestObj] = useState<BundleManifest | null>(null);
  const [manifestSecret, setManifestSecret] = useState("");
  const [manifestVerifyBusy, setManifestVerifyBusy] = useState(false);
  const [manifestVerifyResult, setManifestVerifyResult] = useState<ManifestVerifyResult | null>(null);

  const mappingAudit = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return auditMappingCoverage(rawData);
  }, [rawData]);

  const granularityChecklist = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return evaluateGranularityChecklist(rawData);
  }, [rawData]);

  const identitySuite = useMemo(() => {
    if (!recastData || recastData.length < 1) return null;
    return runIdentityAssertions(recastData);
  }, [recastData]);

  const onManifestUpload = async (file: File | null) => {
    setManifestVerifyResult(null);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BundleManifest;
      setManifestObj(parsed);
      setManifestFileName(file.name);
    } catch {
      setManifestObj(null);
      setManifestFileName(file.name);
      setManifestVerifyResult({
        ok: false,
        inputDigestMatch: false,
        hmacMatch: null,
        mode: "missing",
        details: ["Invalid JSON file. Please upload a valid manifest.json."],
      });
    }
  };

  const verifyManifest = async () => {
    if (!manifestObj) {
      setManifestVerifyResult({
        ok: false,
        inputDigestMatch: false,
        hmacMatch: null,
        mode: "missing",
        details: ["Upload manifest.json first."],
      });
      return;
    }

    setManifestVerifyBusy(true);
    try {
      const details: string[] = [];
      const { signature, ...manifestCore } = manifestObj;
      const payload = JSON.stringify(manifestCore, null, 2);
      const payloadSha = await sha256HexString(payload);

      const mode: "hmac-sha256" | "unsigned" | "missing" = signature?.mode ?? "missing";
      const inputDigestExpected = signature?.inputSha256 ?? "";
      const inputDigestMatch = Boolean(inputDigestExpected) && payloadSha === inputDigestExpected;

      if (!signature) {
        details.push("Signature block is missing from manifest.");
      } else {
        details.push(`Mode: ${signature.mode}${signature.keyId ? ` (keyId: ${signature.keyId})` : ""}`);
      }

      if (inputDigestMatch) {
        details.push("inputSha256 matches manifest payload.");
      } else {
        details.push("inputSha256 mismatch: payload may be tampered or canonicalization changed.");
        details.push(`Expected: ${inputDigestExpected || "(none)"}`);
        details.push(`Computed: ${payloadSha}`);
      }

      let hmacMatch: boolean | null = null;
      if (signature?.mode === "hmac-sha256") {
        if (!manifestSecret.trim()) {
          hmacMatch = false;
          details.push("HMAC mode detected but no secret provided.");
        } else {
          const computedHmac = await hmacSha256Hex(payload, manifestSecret);
          hmacMatch = computedHmac === (signature.hmacSha256 ?? "");
          if (hmacMatch) {
            details.push("hmacSha256 matches provided secret.");
          } else {
            details.push("hmacSha256 mismatch for provided secret.");
            details.push(`Expected: ${signature.hmacSha256 || "(none)"}`);
            details.push(`Computed: ${computedHmac}`);
          }
        }
      }

      const ok = inputDigestMatch && (signature?.mode !== "hmac-sha256" || hmacMatch === true);
      setManifestVerifyResult({ ok, inputDigestMatch, hmacMatch, mode, details });
    } finally {
      setManifestVerifyBusy(false);
    }
  };

  const downloadTextFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportChecklistJSON = () => {
    if (!granularityChecklist) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      summary: granularityChecklist.summary,
      items: granularityChecklist.items,
    };
    downloadTextFile(
      "granularity_checklist_audit.json",
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  };

  const exportChecklistCSV = () => {
    if (!granularityChecklist) return;
    const header = [
      "id",
      "title",
      "status",
      "coveragePct",
      "matchedCount",
      "missingCount",
      "matchedKeys",
      "missingKeys",
      "note",
    ];

    const rows = granularityChecklist.items.map((item) => [
      item.id,
      item.title,
      item.status,
      item.coveragePct.toFixed(2),
      item.matchedKeys.length,
      item.missingKeys.length,
      item.matchedKeys.join(" | "),
      item.missingKeys.join(" | "),
      item.note,
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\n");

    downloadTextFile("granularity_checklist_audit.csv", csv, "text/csv;charset=utf-8");
  };

  const traceRecords = useMemo(() => {
    if (!recastData || recastData.length === 0) return [] as TraceRecord[];

    const rows: TraceRecord[] = [];

    for (const p of recastData) {
      if (!p.trace) continue;
      for (const [line, entries] of Object.entries(p.trace)) {
        for (const e of entries) {
          rows.push({
            period: p.period_end,
            line,
            statement: e.statement,
            key: e.key,
            value: e.value,
            matchType: e.matchType,
            note: e.note ?? "",
          });
        }
      }
    }
    return rows;
  }, [recastData]);

  const exportTraceJSON = () => {
    if (traceRecords.length === 0) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      periods: recastData?.map((p) => p.period_end) ?? [],
      rows: traceRecords,
    };
    downloadTextFile(
      "traceability_appendix.json",
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  };

  const exportTraceCSV = () => {
    if (traceRecords.length === 0) return;
    const header = ["period", "line", "statement", "key", "value", "matchType", "note"];
    const rows = traceRecords.map((r) => [
      r.period,
      r.line,
      r.statement,
      r.key,
      r.value,
      r.matchType,
      r.note,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\n");
    downloadTextFile("traceability_appendix.csv", csv, "text/csv;charset=utf-8");
  };

  // Every base key in any period, not just the oldest one the parser sampled.
  // See `debug/searchableKeys.ts` for what that cost and why it is a union.
  const searchableKeys = useMemo(
    () => searchableBaseKeys(rawData, debugInfo),
    [rawData, debugInfo],
  );

  // Distinct composite and base key counts on one shared basis. The parser's
  // own `metrics.totalCompositeKeys` is a per-period sum and its
  // `totalBaseKeys` is a single period's count, so the two could not be read
  // against each other. See `debug/keyCensus.ts`.
  const census = useMemo(() => parsedKeyCensus(rawData, debugInfo), [rawData, debugInfo]);
  const basisNote = censusBasisNote(census);

  // What the by-statement chips actually add up to. Kept as the parser's own
  // per-period sums (see the card below for why they are not recounted here),
  // so the total is stated on the card rather than left for a reader to add up
  // and compare against a distinct count.
  const statementReadTotal = useMemo(
    () =>
      Object.values(debugInfo?.metrics.byStatement ?? {}).reduce(
        (sum, n) => sum + n,
        0,
      ),
    [debugInfo],
  );

  // Metric search — find a key across all periods and show its values.
  // The match count travels with the rows: a bare `slice` left the panel
  // showing thirty rows for a query that hit 489 keys (measured on Reliance,
  // `q="in"`), with nothing on screen to say so.
  const searchResults = useMemo(() => {
    if (!debugInfo || !metricSearch.trim() || metricSearch.length < 2) return null;
    const q = metricSearch.toLowerCase();

    const matches = searchableKeys.filter((k) => k.toLowerCase().includes(q));

    return { shown: matches.slice(0, SEARCH_ROWS_SHOWN), total: matches.length };
  }, [debugInfo, metricSearch, searchableKeys]);

  if (!debugInfo) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400">
        <div className="text-5xl mb-3">🔍</div>
        <p className="text-lg font-medium text-slate-600">No debug info yet</p>
        {engineError && (
          <p className="text-sm mt-2 text-red-700">Engine error: {engineError}</p>
        )}
        <p className="text-sm mt-1">Upload a Capitaline ZIP to see parsing diagnostics here.</p>
      </div>
    );
  }

  const hasData = debugInfo.detectedPeriods.length > 0;

  // Selected recast period for identity verification
  const recastPeriods = recastData ?? [];
  const verifyPeriod = recastPeriods.length > 0
    ? recastPeriods[Math.min(selectedPeriodIdx, recastPeriods.length - 1)]
    : null;

  return (
    <div className="space-y-5">

      {/* ── Status Banner ── */}
      <div className={`rounded-xl p-5 border ${hasData ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
        <div className="flex items-start gap-3">
          <span className="text-3xl mt-0.5">{hasData ? "✅" : "❌"}</span>
          <div className="flex-1">
            <div className={`font-bold text-lg ${hasData ? "text-green-800" : "text-red-800"}`}>
              {hasData
                ? `Parsed ${debugInfo.detectedPeriods.length} periods from ${debugInfo.files.length} files`
                : `Parse failed — 0 periods from ${debugInfo.files.length} files`}
            </div>
            <div className="text-sm text-slate-600 mt-1">
              {census.compositeKeys.toLocaleString()} composite keys ·{" "}
              {census.baseKeys.toLocaleString()} base metrics ·{" "}
              {debugInfo.warnings.length} warnings
            </div>
            {basisNote && (
              <div className="text-xs text-slate-500 mt-1">{basisNote}</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox label="Files"          value={debugInfo.files.length} />
        <StatBox label="Periods"        value={debugInfo.detectedPeriods.length} highlight={!hasData} />
        {/* "Distinct" is load-bearing: these sat beside "Periods" showing a
            per-period sum, so Infosys read 3,600 composite keys against 15
            periods of 240. */}
        <StatBox label="Distinct Composite Keys" value={census.compositeKeys} />
        <StatBox label="Distinct Base Metrics"   value={census.baseKeys} />
        <StatBox label="Warnings"       value={debugInfo.warnings.length} highlight={debugInfo.warnings.length > 0} />
      </div>

      {/* ── Composite key reads by statement ──
           These chips are the other half of the same basis problem. `byStmt`
           (`capitalineParser.ts:518`) is incremented in the same loop iteration
           as `totalComposite` (`:517`), so each chip is reads-per-period summed
           over every period, and the chips add up to the old composite total —
           11,770 on Bajaj Finance against 1,065 distinct.

           Labelled rather than recounted here. The parser attributes a key from
           its `__` suffix when it has one and from `payload.statement` when it
           does not, and `payload` is not in `rawData`; a UI-side per-statement
           census could only parse suffixes, so it would silently drop the
           suffixless keys. Re-deriving attribution is parser work. */}
      <Card title="Composite Key Reads by Statement">
        <div className="flex gap-3 flex-wrap">
          {Object.entries(debugInfo.metrics.byStatement).map(([s, n]) => (
            <span key={s} className="px-3 py-1.5 bg-slate-100 rounded-full text-sm">
              <strong>{s}</strong>: {n.toLocaleString()}
            </span>
          ))}
        </div>
        {debugInfo.detectedPeriods.length > 1 && (
          <div className="text-xs text-slate-500 mt-2">
            {statementReadTotal.toLocaleString()} reads across{" "}
            {debugInfo.detectedPeriods.length} periods, counting each key once per period
            it appears in — a different basis from the distinct counts above.
          </div>
        )}
        {hasData && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {debugInfo.detectedPeriods.map((p) => (
              <span key={p} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-mono">
                {p.slice(0, 7)}
              </span>
            ))}
          </div>
        )}
      </Card>

      <SourceLineageCard hashes={debugInfo.sourceArtifactHashes} />

      <GreenfieldPanel greenfield={greenfield} />

      {/* ── Mapping Coverage Audit ── */}
      {mappingAudit && (
        <MappingAuditGrid mappingAudit={mappingAudit} qualityGate={qualityGate} />
      )}

      <ManifestVerifyPanel
        manifestObj={manifestObj}
        manifestFileName={manifestFileName}
        manifestSecret={manifestSecret}
        setManifestSecret={setManifestSecret}
        manifestVerifyBusy={manifestVerifyBusy}
        manifestVerifyResult={manifestVerifyResult}
        onManifestUpload={onManifestUpload}
        verifyManifest={verifyManifest}
      />

      {/* ── Identity Test Suite A1–A9 ── */}
      {identitySuite && <IdentitySuitePanel identitySuite={identitySuite} />}

      {/* ── Traceability Panel ── */}
      {verifyPeriod?.trace && (
        <TraceabilityPanel
          trace={verifyPeriod.trace}
          traceRecords={traceRecords}
          selectedTraceLine={selectedTraceLine}
          setSelectedTraceLine={setSelectedTraceLine}
          exportTraceCSV={exportTraceCSV}
          exportTraceJSON={exportTraceJSON}
        />
      )}

      {/* ── Granularity Coverage Checklist ── */}
      {granularityChecklist && (
        <GranularityChecklistPanel
          granularityChecklist={granularityChecklist}
          exportChecklistCSV={exportChecklistCSV}
          exportChecklistJSON={exportChecklistJSON}
        />
      )}

      {/* ── Files in ZIP ── */}
      <Card title="Files in ZIP">
        <div className="space-y-1.5">
          {debugInfo.files.map((f, i) => (
            <div key={i} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
              <span className="font-mono text-sm text-slate-700">{f.name}</span>
              <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-500">{f.statementGuess}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Warnings ── */}
      {debugInfo.warnings.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
          <h3 className="font-bold text-amber-800 mb-3">⚠ Warnings ({debugInfo.warnings.length})</h3>
          <div className="space-y-4">
            {debugInfo.warnings.map((w, i) => (
              <div key={i} className="bg-white rounded-lg p-4 border border-amber-100">
                <div className="font-semibold text-amber-900 text-sm">{w.file || "General"}</div>
                <div className="text-sm text-amber-800 mt-0.5">{w.message}</div>
                {w.detail && (
                  <pre className="mt-2 text-xs bg-slate-900 text-green-400 p-3 rounded font-mono overflow-x-auto whitespace-pre-wrap max-h-48">
                    {w.detail}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recast Verification ── */}
      {recastPeriods.length > 0 && verifyPeriod && (
        <RecastVerificationPanel
          recastPeriods={recastPeriods}
          verifyPeriod={verifyPeriod}
          selectedPeriodIdx={selectedPeriodIdx}
          setSelectedPeriodIdx={setSelectedPeriodIdx}
        />
      )}

      {/* ── Metric Search ── */}
      {hasData && (
        <MetricSearchPanel
          rawData={rawData}
          metricSearch={metricSearch}
          setMetricSearch={setMetricSearch}
          searchResults={searchResults}
        />
      )}

      {/* ── Raw Grid Dumps ── */}
      <RawGridDumps
        debugInfo={debugInfo}
        expandedGrid={expandedGrid}
        setExpandedGrid={setExpandedGrid}
      />

      {/* ── Sample Parsed Metrics ── */}
      {debugInfo.sample.firstRows.length > 0 && (
        <Card title={`Sample Parsed Metrics (${debugInfo.sample.firstRows.length} rows from all files)`}>
          <button
            onClick={() => setShowSample(!showSample)}
            className="text-sm text-indigo-600 hover:underline mb-3 block"
          >
            {showSample ? "Hide" : "Show"} sample
          </button>
          {showSample && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="text-xs font-mono border-collapse w-full">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="px-2 py-1.5 border text-left text-slate-600 min-w-[220px]">Metric</th>
                    <th className="px-2 py-1.5 border text-left text-slate-600 w-24">Stmt</th>
                    {(debugInfo.sample.firstRows[0]?.values ?? []).map((_v, i) => (
                      <th key={i} className="px-2 py-1.5 border text-right text-slate-600 min-w-[80px]">
                        {debugInfo.detectedPeriods[i]?.slice(0, 7) ?? `P${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {debugInfo.sample.firstRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-2 py-1.5 border text-slate-700 max-w-[220px] truncate" title={row.metric}>
                        {row.metric}
                      </td>
                      <td className="px-2 py-1.5 border text-slate-500 text-xs">{row.statement}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="px-2 py-1.5 border text-right text-slate-700">
                          {v ?? <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── All Base Metric Keys ── */}
      {debugInfo.rawMetricKeys.length > 0 && (
        <RawKeysGrid
          debugInfo={debugInfo}
          showAllKeys={showAllKeys}
          setShowAllKeys={setShowAllKeys}
          setMetricSearch={setMetricSearch}
        />
      )}

      {/* ── Collisions ── */}
      {debugInfo.metrics.baseKeyCollisions.length > 0 && (
        <Card title={`Metric Collisions across Statements (${debugInfo.metrics.baseKeyCollisions.length})`}>
          <p className="text-xs text-slate-500 mb-3">
            These metrics appear in multiple statements. The engine uses statement-aware lookup
            (valPL / valBS / valCF) to resolve correctly — the "Kept" column shows the base-key fallback only.
          </p>
          <button
            onClick={() => setShowCollisions(!showCollisions)}
            className="text-sm text-indigo-600 hover:underline mb-3 block"
          >
            {showCollisions ? "Hide" : "Show"} collisions
          </button>
          {showCollisions && (
            <div className="max-h-56 overflow-y-auto space-y-1">
              {debugInfo.metrics.baseKeyCollisions.map((c, i) => (
                <div
                  key={i}
                  className="text-xs py-1.5 border-b border-slate-100 flex justify-between items-center"
                >
                  <span className="font-medium text-slate-700 truncate mr-2 font-mono">{c.metric}</span>
                  <span className="text-slate-400 shrink-0">
                    [{c.statements.join(", ")}] →{" "}
                    <span className="text-indigo-600 font-semibold">{c.keptStatement}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    {/* ── Trace Log Viewer ── */}
      <TraceLogViewer />
    </div>
  );
}
