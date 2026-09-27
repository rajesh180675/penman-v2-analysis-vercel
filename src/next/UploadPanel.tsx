/**
 * Upload a Capitaline export into the Library (docs/ui-revamp-plan.md: "ingest
 * is a drawer, not a tab"). The zip is read in the browser and analysed by the
 * same run store as a library company; it is kept for this session only.
 * Other formats (Screener, XBRL, JSON, manual entry) stay in the classic
 * interface for now.
 */
import { useState, type FormEvent } from "react";
import type { LibraryCompany, LibraryCompanyType } from "../components/data-entry/companyRegistry";

export interface UploadedCompany {
  readonly company: LibraryCompany;
  readonly bytes: Uint8Array;
}

export const UPLOAD_TYPES: readonly LibraryCompanyType[] = [
  "industrial", "consumer", "it-services", "cyclical", "utility", "telecom",
  "conglomerate", "loss-maker", "bank", "nbfc", "insurance",
];

const TICKER = /^[A-Z0-9&.-]{1,20}$/;

export interface UploadDraft {
  readonly fileName: string | null;
  readonly name: string;
  readonly ticker: string;
  readonly type: string;
}

/** Everything wrong with a draft, in reading order; empty when it can be analysed. */
export function validateUpload(draft: UploadDraft, existing: readonly LibraryCompany[]): string[] {
  const errors: string[] = [];
  if (!draft.fileName) errors.push("Choose a Capitaline export (.zip).");
  else if (!draft.fileName.toLowerCase().endsWith(".zip")) errors.push("The file must be a Capitaline .zip export.");
  if (!draft.name.trim()) errors.push("Give the company a name.");
  const ticker = draft.ticker.trim().toUpperCase();
  if (!TICKER.test(ticker)) errors.push("The ticker must be 1–20 letters, digits, &, . or -.");
  else if (existing.some((c) => c.ticker.toUpperCase() === ticker)) errors.push(`${ticker} is already in the library; use another ticker.`);
  if (!UPLOAD_TYPES.includes(draft.type as LibraryCompanyType)) errors.push("Choose the company type.");
  return errors;
}

export function uploadedCompany(draft: UploadDraft): LibraryCompany {
  const ticker = draft.ticker.trim().toUpperCase();
  return {
    folder: `upload-${ticker}`,
    name: draft.name.trim(),
    ticker,
    sector: "Uploaded",
    type: draft.type as LibraryCompanyType,
    description: `Uploaded this session from ${draft.fileName}.`,
    emoji: "",
  };
}

export function UploadPanel({ existing, onUpload }: {
  existing: readonly LibraryCompany[];
  onUpload: (upload: UploadedCompany) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [type, setType] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const draft = { fileName: file?.name ?? null, name, ticker, type };
    const found = validateUpload(draft, existing);
    setErrors(found);
    if (found.length || !file) return;
    setReading(true);
    try {
      onUpload({ company: uploadedCompany(draft), bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch (error) {
      setErrors([`The file could not be read: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setReading(false);
    }
  };

  const field = "mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";
  return (
    <form onSubmit={(e) => { void submit(e); }} aria-labelledby="upload-heading" className="wb-surface rounded-xl border p-4 shadow-sm">
      <h2 id="upload-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Upload a Capitaline export</h2>
      <p className="mt-1 text-xs text-slate-500">
        The file is read and analysed in your browser; only the ticker leaves it, to look up a market price. It is kept for this session only.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="font-medium">Capitaline export (.zip)</span>
          <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={field} />
        </label>
        <label className="text-sm">
          <span className="font-medium">Company name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          <span className="font-medium">Ticker</span>
          <input type="text" value={ticker} onChange={(e) => setTicker(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          <span className="font-medium">Company type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
            <option value="">Choose…</option>
            {UPLOAD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 list-disc pl-5 text-sm text-red-700 dark:text-red-400">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <button type="submit" disabled={reading} className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900">
        {reading ? "Reading…" : "Analyse"}
      </button>
    </form>
  );
}
