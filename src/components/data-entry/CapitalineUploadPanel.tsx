import { trace } from "../../lib/traceLogger";
import type { RawPeriodData, EngineConfig } from "../../engine/types";

type UploadStep = "idle" | "unzipping" | "parsing" | "success" | "failed";

interface Props {
  config: EngineConfig;
  typeNotSelected: boolean;
  isProcessing: boolean;
  error: string;
  uploadedFile: { name: string; size: number } | null;
  setUploadedFile: React.Dispatch<React.SetStateAction<{ name: string; size: number } | null>>;
  uploadStep: UploadStep;
  setUploadStep: React.Dispatch<React.SetStateAction<UploadStep>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  dragOver: boolean;
  setDragOver: React.Dispatch<React.SetStateAction<boolean>>;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  standaloneFile: File | null;
  setStandaloneFile: React.Dispatch<React.SetStateAction<File | null>>;
  dragOverStandalone: boolean;
  setDragOverStandalone: React.Dispatch<React.SetStateAction<boolean>>;
  qualitySidecarFile: File | null;
  setQualitySidecarFile: React.Dispatch<React.SetStateAction<File | null>>;
  dragOverQuality: boolean;
  setDragOverQuality: React.Dispatch<React.SetStateAction<boolean>>;
  parseStandaloneZip: (file: File) => Promise<RawPeriodData[] | null>;
  parseQualitySidecar: (file: File) => Promise<Record<string, unknown> | null>;
  processZip: (
    file: File,
    overrideCompanyId?: string | undefined,
    standalonePeriods?: RawPeriodData[] | null | undefined,
    options?: { skipTypeCheck?: boolean },
  ) => Promise<void>;
}

export default function CapitalineUploadPanel({
  config,
  typeNotSelected,
  isProcessing,
  error,
  uploadedFile,
  setUploadedFile,
  uploadStep,
  setUploadStep,
  setError,
  dragOver,
  setDragOver,
  handleDrop,
  standaloneFile,
  setStandaloneFile,
  dragOverStandalone,
  setDragOverStandalone,
  qualitySidecarFile,
  setQualitySidecarFile,
  dragOverQuality,
  setDragOverQuality,
  parseStandaloneZip,
  parseQualitySidecar,
  processZip,
}: Props) {
  return (
    <div className="m-6 space-y-4">
      {!uploadedFile ? (<>
        {/* Slot 1: Consolidated ZIP — REQUIRED */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">1</span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Consolidated Financial Data</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-50 px-1.5 py-0.5 rounded">Required</span>
          </div>
          <p className="text-xs text-slate-500 ml-7">ZIP containing Balance Sheet + P&amp;L + Cash Flow .xls exports</p>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-all relative overflow-hidden group ${
            typeNotSelected
              // No blanket opacity here: dimming a container that holds text drags
              // its contrast down with it (axe measured slate-800 blending to
              // #777e8b, 4.03:1). The red border and not-allowed cursor carry the
              // disabled state without touching legibility.
              ? "border-red-300 bg-red-50/30 dark:bg-red-950/10 cursor-not-allowed"
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
            <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">Optional</span>
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
                <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">Optional</span>
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
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Ready:</span>
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
  );
}
