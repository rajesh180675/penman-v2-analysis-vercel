/* ── Verify Manifest (HMAC / SHA-256) panel ───────────────────────
   Extracted verbatim from DebugPanel.tsx. Handlers (onManifestUpload,
   verifyManifest) and state remain owned by DebugPanel and are passed
   as props. No logic changes. */

import { Card } from "./debugUi";

export type ManifestSignature = {
  mode: "hmac-sha256" | "unsigned";
  keyId: string | null;
  inputSha256: string;
  hmacSha256: string | null;
};

export type BundleManifest = {
  generatedAt: string;
  bundle: string;
  periodRange: { start: string | null; end: string | null; count: number };
  rowCounts: Record<string, number>;
  checksums: Array<{ file: string; mime: string; bytes: number; sha256: string }>;
  algorithm: string;
  traceability?: {
    schemaVersion?: string | undefined;
    qualityGate?: {
      tier?: string | undefined;
      valuationBlocked?: boolean | undefined;
      scopeClassification?: string | null | undefined;
      scopeBlocked?: boolean | undefined;
    };
    mappingCoverage?: {
      unresolvedBySeverity?: Record<string, number>;
    };
  };
  signature?: ManifestSignature | undefined;
  [k: string]: unknown;
};

export type ManifestVerifyResult = {
  ok: boolean;
  inputDigestMatch: boolean;
  hmacMatch: boolean | null;
  mode: "hmac-sha256" | "unsigned" | "missing";
  details: string[];
};

export function ManifestVerifyPanel({
  manifestObj,
  manifestFileName,
  manifestSecret,
  setManifestSecret,
  manifestVerifyBusy,
  manifestVerifyResult,
  onManifestUpload,
  verifyManifest,
}: {
  manifestObj: BundleManifest | null;
  manifestFileName: string;
  manifestSecret: string;
  setManifestSecret: (value: string) => void;
  manifestVerifyBusy: boolean;
  manifestVerifyResult: ManifestVerifyResult | null;
  onManifestUpload: (file: File | null) => void;
  verifyManifest: () => void;
}) {
  return (
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
  );
}
