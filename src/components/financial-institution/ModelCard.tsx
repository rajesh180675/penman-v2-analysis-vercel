import type { BankValuationModelResult } from "../../engine/bankValuation";
import { fmtCr, fmtPct } from "./financialInstitutionFormatters";

export function ModelCard({ name, model, marketCap }: { name: string; model: BankValuationModelResult; marketCap: number | null | undefined }) {
  const computed = model.status === "computed";
  return (
    <div className={`rounded-lg border p-4 ${computed ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40"}`}>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="font-semibold text-sm">{name}</h4>
        <span className={`text-xs px-2 py-0.5 rounded ${computed ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"}`}>
          {computed ? "computed" : "skipped"}
        </span>
      </div>
      {computed ? (
        <>
          <div className="text-2xl font-bold mb-1">{fmtCr(model.intrinsicValue)}</div>
          {model.premiumOverMarket != null && marketCap != null && marketCap > 0 && (
            <div className={`text-sm ${model.premiumOverMarket > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
              {model.premiumOverMarket > 0 ? "+" : ""}{fmtPct(model.premiumOverMarket, 0)} vs market cap of {fmtCr(marketCap)}
            </div>
          )}
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-2">{model.reason}</div>
          {Object.keys(model.diagnostics).length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-slate-500 dark:text-slate-400">Diagnostics</summary>
              <table className="mt-1 w-full">
                <tbody>
                  {Object.entries(model.diagnostics).map(([k, v]) => (
                    <tr key={k} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="py-0.5 text-slate-600 dark:text-slate-400">{k}</td>
                      <td className="py-0.5 text-right font-mono">{v == null ? "—" : typeof v === "number" ? v.toFixed(4) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      ) : (
        <div className="text-sm text-slate-600 dark:text-slate-400 italic">{model.reason}</div>
      )}
    </div>
  );
}
