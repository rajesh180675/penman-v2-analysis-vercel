import type { ReportArtifactKind } from "../../reporting";

export function ExportToolbar(props: {
  hmacKeyId: string;
  setHmacKeyId: (v: string) => void;
  hmacSecret: string;
  setHmacSecret: (v: string) => void;
  exportWorkbook: () => void;
  exportPdf: () => void;
  exportIcBundle: () => void;
  activeExport: ReportArtifactKind | null;
  notice: {
    tone: "success" | "warning" | "error";
    message: string;
  } | null;
}) {
  const {
    hmacKeyId, setHmacKeyId, hmacSecret, setHmacSecret,
    exportWorkbook, exportPdf, exportIcBundle,
    activeExport, notice,
  } = props;
  const busy = activeExport !== null;
  return (
    <div className="space-y-2" aria-busy={busy}>
      <div className="flex flex-wrap justify-end gap-2">
        <div className="mr-auto grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto">
          <input
            value={hmacKeyId}
            onChange={(e) => setHmacKeyId(e.target.value)}
            placeholder="HMAC Key ID"
            disabled={busy}
            className="px-3 py-2 rounded-lg text-xs border border-slate-300 bg-white"
          />
          <input
            type="password"
            value={hmacSecret}
            onChange={(e) => setHmacSecret(e.target.value)}
            placeholder="HMAC Secret (optional)"
            disabled={busy}
            className="px-3 py-2 rounded-lg text-xs border border-slate-300 bg-white"
          />
        </div>
        <button
          onClick={exportWorkbook}
          disabled={busy}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            busy
              ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          {activeExport === "xlsx" ? "Building XLSX..." : "Export Institutional XLSX"}
        </button>
        <button
          onClick={exportPdf}
          disabled={busy}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            busy
              ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          {activeExport === "pdf" ? "Generating PDF..." : "Export Report as PDF"}
        </button>
        <button
          onClick={exportIcBundle}
          disabled={busy}
          className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
            busy
              ? "bg-indigo-200 text-indigo-100 border-indigo-200 cursor-not-allowed"
              : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
          }`}
        >
          {activeExport === "zip" ? "Building IC Bundle..." : "Export IC Bundle (ZIP)"}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        If HMAC Secret is provided, manifest.json includes tamper-evident HMAC-SHA256 signature over the manifest payload.
      </p>
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          data-testid="report-export-status"
          className={`rounded-lg border px-3 py-2 text-xs ${
            notice.tone === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : notice.tone === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {notice.message}
        </div>
      )}
    </div>
  );
}
