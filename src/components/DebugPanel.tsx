import { useState, useMemo } from "react";
import { CapitalineParseDebug } from "../engine/capitalineParser";
import { RawPeriodData, RecastPeriod } from "../engine/types";
import { auditMappingCoverage, evaluateGranularityChecklist, QualityGateReport } from "../engine/mappingAudit";
import { runIdentityAssertions } from "../engine/identityTests";

interface Props {
  debugInfo: CapitalineParseDebug | null;
  recastData?: RecastPeriod[] | null;
  rawData?: RawPeriodData[] | null;
  qualityGate?: QualityGateReport | null;
  engineError?: string | null;
}

type ManifestSignature = {
  mode: "hmac-sha256" | "unsigned";
  keyId: string | null;
  inputSha256: string;
  hmacSha256: string | null;
};

type BundleManifest = {
  generatedAt: string;
  bundle: string;
  periodRange: { start: string | null; end: string | null; count: number };
  rowCounts: Record<string, number>;
  checksums: Array<{ file: string; mime: string; bytes: number; sha256: string }>;
  algorithm: string;
  traceability?: {
    schemaVersion?: string;
    qualityGate?: {
      tier?: string;
      valuationBlocked?: boolean;
      scopeClassification?: string | null;
      scopeBlocked?: boolean;
    };
    mappingCoverage?: {
      unresolvedBySeverity?: Record<string, number>;
    };
  };
  signature?: ManifestSignature;
  [k: string]: unknown;
};

async function sha256HexString(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export default function DebugPanel({ debugInfo, recastData, rawData, qualityGate, engineError }: Props) {
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
  const [manifestVerifyResult, setManifestVerifyResult] = useState<{
    ok: boolean;
    inputDigestMatch: boolean;
    hmacMatch: boolean | null;
    mode: "hmac-sha256" | "unsigned" | "missing";
    details: string[];
  } | null>(null);

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
    const escapeCell = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

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
      .map((row) => row.map((cell) => escapeCell(cell)).join(","))
      .join("\n");

    downloadTextFile("granularity_checklist_audit.csv", csv, "text/csv;charset=utf-8");
  };

  const traceRecords = useMemo(() => {
    if (!recastData || recastData.length === 0) return [] as Array<{
      period: string;
      line: string;
      statement: string;
      key: string;
      value: number;
      matchType: string;
      note: string;
    }>;

    const rows: Array<{
      period: string;
      line: string;
      statement: string;
      key: string;
      value: number;
      matchType: string;
      note: string;
    }> = [];

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
    const escapeCell = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
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
      .map((row) => row.map((cell) => escapeCell(cell)).join(","))
      .join("\n");
    downloadTextFile("traceability_appendix.csv", csv, "text/csv;charset=utf-8");
  };

  // Metric search — find a key across all periods and show its values
  const searchResults = useMemo(() => {
    if (!debugInfo || !metricSearch.trim() || metricSearch.length < 2) return null;
    const q = metricSearch.toLowerCase();

    // Search in rawMetricKeys
    const matches = debugInfo.rawMetricKeys.filter((k) =>
      k.toLowerCase().includes(q)
    );

    return matches.slice(0, 30);
  }, [debugInfo, metricSearch]);

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
              {debugInfo.metrics.totalCompositeKeys.toLocaleString()} composite keys ·{" "}
              {debugInfo.metrics.totalBaseKeys.toLocaleString()} base metrics ·{" "}
              {debugInfo.warnings.length} warnings
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox label="Files"          value={debugInfo.files.length} />
        <StatBox label="Periods"        value={debugInfo.detectedPeriods.length} highlight={!hasData} />
        <StatBox label="Composite Keys" value={debugInfo.metrics.totalCompositeKeys} />
        <StatBox label="Base Metrics"   value={debugInfo.metrics.totalBaseKeys} />
        <StatBox label="Warnings"       value={debugInfo.warnings.length} highlight={debugInfo.warnings.length > 0} />
      </div>

      {/* ── Metrics by Statement ── */}
      <Card title="Metrics by Statement">
        <div className="flex gap-3 flex-wrap">
          {Object.entries(debugInfo.metrics.byStatement).map(([s, n]) => (
            <span key={s} className="px-3 py-1.5 bg-slate-100 rounded-full text-sm">
              <strong>{s}</strong>: {n.toLocaleString()}
            </span>
          ))}
        </div>
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

      {/* ── Mapping Coverage Audit ── */}
      {mappingAudit && (
        <Card title="Mapping Coverage Audit">
          {qualityGate && (
            <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${
              qualityGate.scopeAssessment.blocked
                ? "bg-red-50 border-red-200 text-red-800"
                : qualityGate.tier === "Tier 1"
                ? "bg-green-50 border-green-200 text-green-800"
                : qualityGate.tier === "Tier 2"
                  ? "bg-amber-50 border-amber-200 text-amber-900"
                  : "bg-red-50 border-red-200 text-red-800"
            }`}>
              <strong>{qualityGate.tier}</strong> · {qualityGate.scopeAssessment.blocked ? "Unsupported scope blocked" : qualityGate.valuationBlocked ? "Valuation blocked" : "Valuation enabled"}
              {qualityGate.blockingReasons.length > 0 && (
                <ul className="list-disc pl-5 mt-2 text-xs space-y-0.5">
                  {qualityGate.blockingReasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
            </div>
          )}
          {qualityGate?.scopeAssessment.signals.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <StatBox label="Blocking" value={qualityGate.coverageSummary.unresolvedBySeverity.critical.length} highlight={qualityGate.coverageSummary.unresolvedBySeverity.critical.length > 0 || qualityGate.scopeAssessment.blocked} />
              <StatBox label="Diagnostic" value={qualityGate.coverageSummary.unresolvedBySeverity.warning.length} highlight={qualityGate.coverageSummary.unresolvedBySeverity.warning.length > 0} />
              <StatBox label="Optional" value={qualityGate.coverageSummary.unresolvedBySeverity.info.length} />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <StatBox label="Blocking" value={qualityGate?.coverageSummary.unresolvedBySeverity.critical.length ?? 0} highlight={(qualityGate?.coverageSummary.unresolvedBySeverity.critical.length ?? 0) > 0} />
              <StatBox label="Diagnostic" value={qualityGate?.coverageSummary.unresolvedBySeverity.warning.length ?? 0} highlight={(qualityGate?.coverageSummary.unresolvedBySeverity.warning.length ?? 0) > 0} />
              <StatBox label="Optional" value={qualityGate?.coverageSummary.unresolvedBySeverity.info.length ?? 0} />
            </div>
          )}
          {qualityGate?.scopeAssessment.signals.length ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <div className="font-semibold mb-1">Scope signals</div>
              <div>{qualityGate.scopeAssessment.signals.slice(0, 6).map((signal) => `${signal.kind}: ${signal.key}`).join(" · ")}</div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <StatBox label="BS keys in dataset" value={mappingAudit.datasetKeyCounts.BalanceSheet} />
            <StatBox label="PL keys in dataset" value={mappingAudit.datasetKeyCounts.ProfitLoss} />
            <StatBox label="CF keys in dataset" value={mappingAudit.datasetKeyCounts.CashFlow} />
            <StatBox label="Unknown keys" value={mappingAudit.datasetKeyCounts.Unknown} highlight={mappingAudit.datasetKeyCounts.Unknown > 0} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="font-semibold text-sm text-slate-700 mb-2">Used keys not present in YAML</div>
              <div className="text-xs text-slate-500 mb-2">
                Keys referenced by engine spec but missing from YAML mapping file.
              </div>
              <div className="max-h-40 overflow-auto text-xs font-mono space-y-1">
                {mappingAudit.usedKeysNotInYaml.length === 0 ? (
                  <div className="text-green-700">None</div>
                ) : (
                  mappingAudit.usedKeysNotInYaml.map((k) => <div key={k}>{k}</div>)
                )}
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg p-3">
              <div className="font-semibold text-sm text-slate-700 mb-2">YAML keys not present in dataset</div>
              <div className="text-xs text-slate-500 mb-2">
                Declared mapping keys not found in uploaded raw metrics.
              </div>
              <div className="max-h-40 overflow-auto text-xs font-mono space-y-1">
                {mappingAudit.yamlKeysNotInDataset.length === 0 ? (
                  <div className="text-green-700">None</div>
                ) : (
                  mappingAudit.yamlKeysNotInDataset.slice(0, 200).map((k) => <div key={k}>{k}</div>)
                )}
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg p-3">
              <div className="font-semibold text-sm text-slate-700 mb-2">Unresolved critical keys by statement</div>
              <div className="text-xs text-slate-500 mb-2">
                Minimum critical keys missing in dataset by statement.
              </div>
              <div className="text-xs space-y-2">
                {(["BalanceSheet", "ProfitLoss", "CashFlow"] as const).map((s) => (
                  <div key={s}>
                    <div className="font-semibold text-slate-600">{s}</div>
                    {mappingAudit.unresolvedCriticalByStatement[s].length === 0 ? (
                      <div className="text-green-700 font-mono">None</div>
                    ) : (
                      <div className="max-h-24 overflow-auto font-mono space-y-0.5">
                        {mappingAudit.unresolvedCriticalByStatement[s].map((k) => <div key={k}>{k}</div>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title="Verify Manifest (HMAC / SHA-256)">
        <p className="text-xs text-slate-500 mb-3">
          Upload <span className="font-mono">manifest.json</span> from IC bundle and verify its
          <span className="font-mono"> inputSha256</span> and optional
          <span className="font-mono"> hmacSha256</span> in-browser.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">manifest.json</label>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => onManifestUpload(e.target.files?.[0] ?? null)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs"
            />
            {manifestFileName && <div className="text-xs text-slate-500 mt-1">Loaded: {manifestFileName}</div>}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">HMAC secret (optional)</label>
            <input
              type="password"
              value={manifestSecret}
              onChange={(e) => setManifestSecret(e.target.value)}
              placeholder="Required only for hmac-sha256"
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={verifyManifest}
            disabled={manifestVerifyBusy || !manifestObj}
            className="px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {manifestVerifyBusy ? "Verifying..." : "Verify Manifest"}
          </button>
          {manifestObj?.signature?.mode && (
            <span className="text-xs text-slate-500">Signature mode: {manifestObj.signature.mode}</span>
          )}
        </div>

        {manifestVerifyResult && (
          <div
            className={`rounded-lg border p-3 text-xs ${
              manifestVerifyResult.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
            }`}
          >
            <div className={`font-semibold mb-2 ${manifestVerifyResult.ok ? "text-green-700" : "text-red-700"}`}>
              {manifestVerifyResult.ok ? "Verification PASSED" : "Verification FAILED"}
            </div>
            <div className="text-slate-600 space-y-1 font-mono">
              <div>mode: {manifestVerifyResult.mode}</div>
              <div>inputSha256: {manifestVerifyResult.inputDigestMatch ? "match" : "mismatch"}</div>
              <div>
                hmacSha256: {manifestVerifyResult.hmacMatch == null ? "not-applicable" : manifestVerifyResult.hmacMatch ? "match" : "mismatch"}
              </div>
            </div>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-700">
              {manifestVerifyResult.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── Identity Test Suite A1–A9 ── */}
      {identitySuite && (
        <Card title="Unit Test Suite — Accounting Identities (A1–A9)">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatBox label="Assertions" value={identitySuite.total} />
            <StatBox label="Passed" value={identitySuite.passed} />
            <StatBox label="Failed" value={identitySuite.failed} highlight={identitySuite.failed > 0} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            {Object.entries(identitySuite.byAssertion).map(([id, s]) => (
              <div key={id} className="border border-slate-200 rounded-lg p-2 text-xs">
                <div className="font-semibold text-slate-700">{id}</div>
                <div className="text-green-700">Pass: {s.passed}</div>
                <div className={`${s.failed > 0 ? "text-red-700" : "text-slate-500"}`}>Fail: {s.failed}</div>
              </div>
            ))}
          </div>
          {identitySuite.failed > 0 && (
            <div className="max-h-56 overflow-auto border border-red-200 bg-red-50 rounded-lg p-3 text-xs font-mono space-y-1">
              {identitySuite.results.filter((r) => !r.pass).slice(0, 120).map((r, i) => (
                <div key={`${r.id}-${r.period}-${i}`}>
                  {r.period} {r.id} diff={r.diff.toFixed(4)} (tol={r.tolerance.toFixed(4)})
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Traceability Panel ── */}
      {verifyPeriod?.trace && (
        <Card title="Traceability Panel — Source key → statement → value">
          <p className="text-xs text-slate-500 mb-3">
            Audit trail for computed lines in selected period. Click a line to inspect exact source metric keys and matched statement.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={exportTraceCSV}
              disabled={traceRecords.length === 0}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Export Trace CSV
            </button>
            <button
              onClick={exportTraceJSON}
              disabled={traceRecords.length === 0}
              className="px-3 py-1.5 rounded-md bg-slate-700 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Export Trace JSON
            </button>
            <span className="text-xs text-slate-500 self-center">
              {traceRecords.length.toLocaleString()} trace rows across all periods.
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-lg p-2 max-h-80 overflow-auto">
              {Object.keys(verifyPeriod.trace).sort().map((line) => (
                <button
                  key={line}
                  onClick={() => setSelectedTraceLine(line)}
                  className={`w-full text-left px-2 py-1 rounded text-xs font-mono ${
                    selectedTraceLine === line ? "bg-indigo-100 text-indigo-800" : "hover:bg-slate-100 text-slate-700"
                  }`}
                >
                  {line}
                </button>
              ))}
            </div>
            <div className="border border-slate-200 rounded-lg p-3 max-h-80 overflow-auto">
              {selectedTraceLine && verifyPeriod.trace[selectedTraceLine] ? (
                <div className="space-y-2">
                  <div className="font-semibold text-sm text-slate-700">{selectedTraceLine}</div>
                  {verifyPeriod.trace[selectedTraceLine].map((t, i) => (
                    <div key={i} className="text-xs border border-slate-100 rounded p-2 bg-slate-50">
                      <div><span className="text-slate-500">statement:</span> <span className="font-mono">{t.statement}</span></div>
                      <div><span className="text-slate-500">key:</span> <span className="font-mono">{t.key}</span></div>
                      <div><span className="text-slate-500">value:</span> <span className="font-mono">{t.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></div>
                      <div><span className="text-slate-500">match:</span> <span className="font-mono">{t.matchType}</span></div>
                      {t.note ? <div className="text-amber-700">{t.note}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400">Select a line to inspect trace entries.</div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Granularity Coverage Checklist ── */}
      {granularityChecklist && (
        <Card title="Granularity Coverage Checklist (10 requested domains)">
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={exportChecklistCSV}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
            >
              Export CSV
            </button>
            <button
              onClick={exportChecklistJSON}
              className="px-3 py-1.5 rounded-md bg-slate-700 text-white text-xs font-medium hover:bg-slate-800"
            >
              Export JSON
            </button>
            <span className="text-xs text-slate-500 self-center">
              Audit trail download includes status, coverage, matched keys, and missing keys.
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatBox label="Pass" value={granularityChecklist.summary.pass} />
            <StatBox label="Partial" value={granularityChecklist.summary.partial} highlight={granularityChecklist.summary.partial > 0} />
            <StatBox label="Fail" value={granularityChecklist.summary.fail} highlight={granularityChecklist.summary.fail > 0} />
          </div>

          <div className="space-y-3">
            {granularityChecklist.items.map((item) => (
              <div key={item.id} className="border border-slate-200 rounded-lg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="font-semibold text-sm text-slate-700">{item.title}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                      coverage {item.coveragePct.toFixed(0)}%
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-semibold ${
                        item.status === "pass"
                          ? "bg-green-100 text-green-700"
                          : item.status === "partial"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mb-2">{item.note}</p>
                <div className="text-xs mb-1 text-slate-600 font-semibold">Mapped keys used ({item.matchedKeys.length})</div>
                {item.matchedKeys.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {item.matchedKeys.slice(0, 18).map((k) => (
                      <span key={k} className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-mono">
                        {k}
                      </span>
                    ))}
                    {item.matchedKeys.length > 18 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                        +{item.matchedKeys.length - 18} more
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-red-600 mb-2">No mapped keys found in dataset for this domain.</div>
                )}
                {item.missingKeys.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                      Show missing mapped keys ({item.missingKeys.length})
                    </summary>
                    <div className="mt-2 max-h-28 overflow-auto space-y-1">
                      {item.missingKeys.map((k) => (
                        <div key={k} className="text-[11px] text-slate-500 font-mono">
                          {k}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Card>
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
        <Card title="Recast Verification — Identity Checks (paper Eq. 2–3)">
          {/* Period selector */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            {recastPeriods.map((d, i) => (
              <button
                key={i}
                onClick={() => setSelectedPeriodIdx(i)}
                className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
                  i === selectedPeriodIdx
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                }`}
              >
                {d.period_end.slice(0, 7)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-5">
            {/* BS snapshot */}
            <div>
              <h4 className="font-semibold text-slate-600 text-sm mb-3">Balance Sheet</h4>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(verifyPeriod.bs).map(([k, v]) => (
                  <div key={k} className="p-2 bg-slate-50 rounded border border-slate-100">
                    <div className="text-xs text-slate-400 font-mono">{k}</div>
                    <div className="font-mono font-bold text-sm text-slate-800">
                      {(v as number).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* IS snapshot */}
            <div>
              <h4 className="font-semibold text-slate-600 text-sm mb-3">Income Statement</h4>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(verifyPeriod.is).map(([k, v]) => (
                  <div key={k} className="p-2 bg-slate-50 rounded border border-slate-100">
                    <div className="text-xs text-slate-400 font-mono">{k}</div>
                    <div className="font-mono font-bold text-sm text-slate-800">
                      {(v as number).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Identity checks */}
          {(() => {
            const bs = verifyPeriod.bs;
            const is = verifyPeriod.is;
            const ta_check = Math.abs(bs.OA + bs.FA - bs.TA);
            const noa_check = Math.abs(bs.NOA - (bs.OA - bs.OL));
            const nfo_check = Math.abs(bs.NFO - (bs.FO - bs.FA));
            const equity_diff = Math.abs((bs.CSE + bs.MI) - (bs.NOA - bs.NFO));

            // OI identity: OI = CNI + NFE + MII
            // MII = TCI_NCI (shown implicitly as TCI_group - TCI_owners)
            // OI_computed = CNI + NFE (MII already included in CNI computation for standalone)
            const MII_est = is.TCI > 0
              ? Math.max(0, is.TCI - is.CNI - (is.FinanceCost > 0 ? 0 : 0)) // rough
              : 0;
            const oi_from_cni_nfe = is.CNI + is.NFE;
            const oi_from_cni_nfe_mii = oi_from_cni_nfe + MII_est;
            const oi_diff_no_mii = Math.abs(oi_from_cni_nfe - is.OI);
            const oi_diff_with_mii = Math.abs(oi_from_cni_nfe_mii - is.OI);
            const oi_ok = oi_diff_no_mii < 5 || oi_diff_with_mii < 5;

            // Compute MII as TCI - CNI - OI (approximate from stored values)
            const mii_approx = is.TCI !== 0
              ? is.TCI - (is.CNI + (is.PreferredDividend ?? 0)) - is.NFE - is.OI
              : 0;

            return (
              <div className="font-mono text-xs bg-slate-900 text-slate-100 p-4 rounded-lg space-y-2">
                <div className="text-slate-300 text-sm font-sans font-semibold mb-2 pb-2 border-b border-slate-700">
                  Identity Checks — {verifyPeriod.period_end}
                </div>

                <IdentityRow
                  label="TA = OA + FA"
                  lhs={bs.TA.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  rhs={`${bs.OA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} + ${bs.FA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} = ${(bs.OA + bs.FA).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                  ok={ta_check < 5}
                  diff={ta_check}
                />
                <IdentityRow
                  label="NOA = OA − OL"
                  lhs={bs.NOA.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  rhs={`${bs.OA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} − ${bs.OL.toLocaleString("en-IN", { maximumFractionDigits: 2 })} = ${(bs.OA - bs.OL).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                  ok={noa_check < 2}
                  diff={noa_check}
                />
                <IdentityRow
                  label="NFO = FO − FA"
                  lhs={bs.NFO.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  rhs={`${bs.FO.toLocaleString("en-IN", { maximumFractionDigits: 2 })} − ${bs.FA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} = ${(bs.FO - bs.FA).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                  ok={nfo_check < 2}
                  diff={nfo_check}
                />
                <IdentityRow
                  label="(CSE+MI) = NOA − NFO"
                  lhs={(bs.CSE + bs.MI).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  rhs={`${bs.NOA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} − (${bs.NFO.toLocaleString("en-IN", { maximumFractionDigits: 2 })}) = ${(bs.NOA - bs.NFO).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                  ok={equity_diff < 5}
                  diff={equity_diff}
                />
                <IdentityRow
                  label="OI = CNI + NFE"
                  lhs={is.OI.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  rhs={`${is.CNI.toLocaleString("en-IN", { maximumFractionDigits: 2 })} + (${is.NFE.toLocaleString("en-IN", { maximumFractionDigits: 2 })}) = ${oi_from_cni_nfe.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                  ok={oi_ok}
                  diff={oi_diff_no_mii}
                />

                {oi_diff_no_mii > 5 && (
                  <div className="text-amber-300 text-xs ml-4 border-l-2 border-amber-500 pl-3 py-1">
                    ⚠ OI diff = {oi_diff_no_mii.toFixed(1)} ← This is the NCI income share (MII).
                    <br />
                    OI = CNI + NFE + MII: {is.CNI.toFixed(1)} + ({is.NFE.toFixed(1)}) + ~{(mii_approx).toFixed(1)} = {(is.CNI + is.NFE + mii_approx).toFixed(1)}
                    <br />
                    <span className="text-slate-400">
                      For consolidated companies, MII = NCI's comprehensive income share.
                      The diff equals the NCI P&L line in the Capitaline P&L export.
                      CNI is correctly computed as TCI_group − TCI_NCI.
                    </span>
                  </div>
                )}

                <div className="text-slate-400 pt-2 border-t border-slate-700 space-y-0.5">
                  <div>Eff. Tax Rate ≈ {PBTStr(is)} | Finance Income (est.): {is.FinanceIncome.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | Finance Cost: {is.FinanceCost.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | NFE: {is.NFE.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                  <div>OI: {is.OI.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | CNI: {is.CNI.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | TCI group: {is.TCI.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | OCI: {is.OCI.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      {/* ── Metric Search ── */}
      {hasData && (
        <Card title="🔎 Metric Key Search">
          <p className="text-xs text-slate-500 mb-3">
            Search any metric name to see its raw parsed values across all periods.
            Useful for reconciling specific line items.
          </p>
          <input
            value={metricSearch}
            onChange={(e) => setMetricSearch(e.target.value)}
            placeholder="e.g. Finance Cost, Non-Controlling, Total Assets…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 mb-3"
          />
          {searchResults && searchResults.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="text-xs font-mono border-collapse w-full">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="px-2 py-1.5 border text-left text-slate-600 min-w-[300px]">Metric Key</th>
                    {debugInfo.detectedPeriods.slice(0, 10).map((p, i) => (
                      <th key={i} className="px-2 py-1.5 border text-right text-slate-600 min-w-[80px]">
                        {p.slice(0, 7)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((key, ri) => {
                    // Find period data from recastData or debugInfo
                    return (
                      <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="px-2 py-1.5 border text-slate-700 max-w-xs truncate" title={key}>
                          {key}
                        </td>
                        {/* Show values if we have debug sample data */}
                        {debugInfo.detectedPeriods.slice(0, 10).map((_, pi) => {
                          const sampleRow = debugInfo.sample.firstRows.find(
                            (r) => r.metric === key || r.metric.toLowerCase() === key.toLowerCase()
                          );
                          const val = sampleRow?.values[pi] ?? "—";
                          return (
                            <td key={pi} className="px-2 py-1.5 border text-right text-slate-700">
                              {val ?? <span className="text-slate-300">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {searchResults && searchResults.length === 0 && metricSearch.length >= 2 && (
            <div className="text-sm text-slate-400 text-center py-4">
              No metric keys match "{metricSearch}"
            </div>
          )}
        </Card>
      )}

      {/* ── Raw Grid Dumps ── */}
      <Card title="Raw Grid Dumps (per file — click to expand)">
        <p className="text-xs text-slate-500 mb-3">
          First 30 rows after cleaning Angular template residue.
          Yellow row = detected year header. C0 = metric name, C1+ = period values.
        </p>
        <div className="space-y-3">
          {debugInfo.rawGrids.map((gd, i) => (
            <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedGrid(expandedGrid === gd.file ? null : gd.file)}
                className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 flex flex-wrap justify-between items-center text-left gap-2"
              >
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-700 text-sm">{gd.file}</span>
                  <span className="text-xs text-slate-400">
                    {gd.rowCount}r × {gd.colCount}c | best: {gd.bestMethod}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {gd.methods.map((m, j) => (
                    <span key={j} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-mono">{m}</span>
                  ))}
                  {gd.headerDetected ? (
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                      ✓ header@row{gd.headerRowIndex}
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded font-bold">✗ NO HEADER</span>
                  )}
                  <span className="text-slate-400 text-xs">{expandedGrid === gd.file ? "▲" : "▼"}</span>
                </div>
              </button>

              {expandedGrid === gd.file && (
                <div className="p-4 space-y-4 bg-white">
                  {gd.errors.length > 0 && (
                    <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg space-y-1">
                      <div className="font-semibold">Parse errors:</div>
                      {gd.errors.map((e, j) => <div key={j}>• {e}</div>)}
                    </div>
                  )}
                  {gd.headerDetected && gd.periodLabels && (
                    <div>
                      <div className="text-xs font-semibold text-slate-500 mb-2">
                        Period columns detected ({gd.periodLabels.length}):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {gd.periodLabels.map((l, j) => (
                          <span key={j} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-mono">{l}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {gd.firstRows.length === 0 ? (
                    <div className="text-sm text-red-500 font-medium py-8 text-center border-2 border-dashed border-red-200 rounded-lg">
                      ⚠ Grid is EMPTY — all parse strategies returned 0 rows.
                    </div>
                  ) : (
                    <>
                      <div className="text-xs font-semibold text-slate-500 mb-1">First {gd.firstRows.length} rows:</div>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="text-xs font-mono border-collapse min-w-full">
                          <thead>
                            <tr className="bg-slate-100">
                              <th className="px-2 py-1 border border-slate-200 text-slate-400 w-8">#</th>
                              {(gd.firstRows[0] ?? []).slice(0, 12).map((_c, ci) => (
                                <th key={ci} className="px-2 py-1 border border-slate-200 text-slate-500 min-w-[90px]">C{ci}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {gd.firstRows.map((row, ri) => (
                              <tr
                                key={ri}
                                className={ri === gd.headerRowIndex ? "bg-yellow-100 font-bold" : ri % 2 === 0 ? "bg-white" : "bg-slate-50"}
                              >
                                <td className="px-2 py-1 border border-slate-200 text-slate-300 text-center">{ri}</td>
                                {row.slice(0, 12).map((cell, ci) => (
                                  <td
                                    key={ci}
                                    className={`px-2 py-1 border border-slate-200 max-w-[120px] truncate ${ci === 0 ? "text-left" : "text-right"}`}
                                    title={cell}
                                  >
                                    {cell || <span className="text-slate-200">·</span>}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-slate-400">Hover cells to see full content.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

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
        <Card title={`All Base Metric Keys in Period 1 (${debugInfo.rawMetricKeys.length} keys)`}>
          <button
            onClick={() => setShowAllKeys(!showAllKeys)}
            className="text-sm text-indigo-600 hover:underline mb-3 block"
          >
            {showAllKeys ? "Hide" : "Show all keys"}
          </button>
          {showAllKeys && (
            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg p-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                {debugInfo.rawMetricKeys.sort().map((k, i) => (
                  <div
                    key={i}
                    className="text-xs font-mono text-slate-600 bg-slate-50 px-2 py-1 rounded truncate cursor-pointer hover:bg-indigo-50 hover:text-indigo-700"
                    title={k}
                    onClick={() => setMetricSearch(k)}
                  >
                    {k}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
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
    </div>
  );
}

/* ── Helpers ── */

function PBTStr(is: RecastPeriod["is"]): string {
  const pbt = is.PAT + is.TaxExpense;
  if (pbt > 0 && is.TaxExpense > 0) {
    return `${is.TaxExpense.toLocaleString("en-IN", { maximumFractionDigits: 2 })} / PBT ≈ ${((is.TaxExpense / pbt) * 100).toFixed(1)}%`;
  }
  return "N/A";
}

function IdentityRow({
  label, lhs, rhs, ok, diff,
}: {
  label: string; lhs: string; rhs: string; ok: boolean; diff: number;
}) {
  return (
    <div className={`flex flex-wrap items-start gap-x-2 gap-y-0.5 ${ok ? "text-green-300" : "text-red-300"}`}>
      <span className="text-slate-400 w-40 shrink-0 text-xs">{label}:</span>
      <span className="text-xs">{lhs}</span>
      <span className="text-slate-500">=</span>
      <span className="text-xs">{rhs}</span>
      <span className={`ml-auto font-bold text-xs ${ok ? "text-green-400" : "text-red-400"}`}>
        {ok ? "✓" : `⚠ diff=${diff.toFixed(1)}`}
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
        <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-xl border ${highlight ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
      <div className={`text-2xl font-bold ${highlight ? "text-amber-700" : "text-slate-800"}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}
