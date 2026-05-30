export function ExportToolbar(props: {
  hmacKeyId: string;
  setHmacKeyId: (v: string) => void;
  hmacSecret: string;
  setHmacSecret: (v: string) => void;
  exportWorkbook: () => void;
  exportPdf: () => void;
  exportIcBundle: () => void;
  exportingBundle: boolean;
  exportingPdf: boolean;
  exportingXlsx: boolean;
}) {
  const {
    hmacKeyId, setHmacKeyId, hmacSecret, setHmacSecret,
    exportWorkbook, exportPdf, exportIcBundle,
    exportingBundle, exportingPdf, exportingXlsx,
  } = props;
  return (
    <>
      <div className="flex justify-end gap-2">
        <div className="mr-auto grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto">
          <input
            value={hmacKeyId}
            onChange={(e) => setHmacKeyId(e.target.value)}
            placeholder="HMAC Key ID"
            className="px-3 py-2 rounded-lg text-xs border border-slate-300 bg-white"
          />
          <input
            type="password"
            value={hmacSecret}
            onChange={(e) => setHmacSecret(e.target.value)}
            placeholder="HMAC Secret (optional)"
            className="px-3 py-2 rounded-lg text-xs border border-slate-300 bg-white"
          />
        </div>
        <button
          onClick={exportWorkbook}
          disabled={exportingBundle || exportingPdf || exportingXlsx}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            exportingBundle || exportingPdf || exportingXlsx
              ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          {exportingXlsx ? "Building XLSX..." : "Export Institutional XLSX"}
        </button>
        <button
          onClick={exportPdf}
          disabled={exportingPdf || exportingBundle}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            exportingPdf || exportingBundle
              ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          {exportingPdf ? "Generating PDF..." : "Export Report as PDF"}
        </button>
        <button
          onClick={exportIcBundle}
          disabled={exportingBundle || exportingPdf}
          className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
            exportingBundle || exportingPdf
              ? "bg-indigo-200 text-indigo-100 border-indigo-200 cursor-not-allowed"
              : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
          }`}
        >
          {exportingBundle ? "Building IC Bundle..." : "Export IC Bundle (ZIP)"}
        </button>
      </div>
      <p className="text-xs text-slate-500 -mt-2">
        If HMAC Secret is provided, manifest.json includes tamper-evident HMAC-SHA256 signature over the manifest payload.
      </p>
    </>
  );
}
