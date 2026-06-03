import { useEffect, useState } from "react";
import type { CompanyType } from "../../engine/types";

const TYPES: { value: CompanyType; label: string }[] = [
  { value: "auto", label: "Auto (detect from data)" },
  { value: "bank", label: "Bank" },
  { value: "nbfc", label: "NBFC" },
  { value: "insurance", label: "Insurance" },
  { value: "industrial", label: "Industrial / Conglomerate" },
  { value: "it-services", label: "IT Services" },
  { value: "consumer", label: "Consumer / FMCG" },
  { value: "utility", label: "Utility / PSU" },
  { value: "telecom", label: "Telecom" },
  { value: "cyclical", label: "Cyclical / Metals" },
];

interface CompanyPickInfo {
  folder: string;
  ticker: string;
  type: string;  // registry type (may be "conglomerate" etc.)
  hasStandalone: boolean;
  blobUrl?: string | null | undefined;
  standaloneBlobUrl?: string | null | undefined;
  qualityIndicatorsBlobUrl?: string | null | undefined;
}

interface Props {
  company: CompanyPickInfo | null;
  onConfirm: (company: CompanyPickInfo, chosenType: CompanyType) => void;
  onCancel: () => void;
}

export function registryTypeToDefault(registryType: string): CompanyType {
  const direct = ["bank", "nbfc", "insurance", "it-services", "consumer", "utility", "telecom", "cyclical"] as const;
  if ((direct as readonly string[]).includes(registryType)) return registryType as CompanyType;
  // conglomerate, loss-maker, etc. → industrial
  return "industrial";
}

export default function CompanyTypePickerModal({ company, onConfirm, onCancel }: Props) {
  const defaultType = company ? registryTypeToDefault(company.type) : "auto";
  const [chosen, setChosen] = useState<CompanyType>(defaultType);

  useEffect(() => {
    setChosen(defaultType);
  }, [defaultType, company?.folder, company?.ticker]);

  if (!company) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {company.folder}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {company.ticker} · Registry type: <span className="font-mono">{company.type}</span>
          </p>
        </div>

        {/* Type selector */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Analysis pipeline
          </label>
          <select
            value={chosen}
            onChange={e => setChosen(e.target.value as CompanyType)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            {TYPES.map(t => (
              <option key={t.value} value={t.value}>
                {t.value === defaultType ? `${t.label} ← suggested` : t.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            Manual choice bypasses signal detection. Auto lets the engine decide from data.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onConfirm(company, chosen)}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Load
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
