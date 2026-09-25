/**
 * Case §5 — Valuation: every catalogued model's result for this run (computed
 * or withheld with its reason), the cost of capital with its provenance, and a
 * ke × terminal-growth sensitivity grid on the base case. Financial
 * institutions get the same model table; the industrial-only parts are
 * withheld with the reason.
 */
import { useMemo } from "react";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import { CURRENT_MODEL_REGISTRY } from "../../engine/modelCatalog";
import { formatPerShare } from "../../engine/valuationCommandCenter";
import { revalueBase } from "../../engine/valuationCommandCenter/breakEven";
import { crore, percent } from "../format";
import { Withheld } from "../ui/Withheld";

type ModelResult = LegacyAnalysisRunExecutionResult["materialization"]["modelResults"][number];
type CommandCenter = NonNullable<LegacyAnalysisRunExecutionResult["materialization"]["commandCenter"]>;
type RevalueInput = Parameters<typeof revalueBase>[0];

export const SENSITIVITY_KE = [-0.02, -0.01, 0, 0.01, 0.02] as const;
export const SENSITIVITY_G = [-0.01, -0.005, 0, 0.005, 0.01] as const;

export function ValuationSection({ result }: { result: LegacyAnalysisRunExecutionResult }) {
  const cc = result.materialization.commandCenter;
  return (
    <div className="space-y-4">
      <Models results={result.materialization.modelResults} />
      {cc ? (
        <>
          <CostOfCapital cc={cc} />
          <Sensitivity cc={cc} />
        </>
      ) : (
        <div className="wb-surface rounded-xl border p-4 shadow-sm">
          <Withheld reason="No industrial valuation for this run, so no cost-of-capital build or sensitivity grid; the financial-institution models above carry the valuation." />
        </div>
      )}
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="wb-surface rounded-xl border p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      {children}
    </div>
  );
}

function Models({ results }: { results: readonly ModelResult[] }) {
  const rows = results.map((r) => {
    const definition = CURRENT_MODEL_REGISTRY.get(r.modelId);
    return { result: r, label: definition?.label ?? r.modelId, category: definition?.category ?? "unknown", lifecycle: definition?.lifecycle ?? "unknown" };
  });
  const computed = rows.filter((r) => r.result.status === "computed").length;
  return (
    <Card title="Models" note={`${computed} of ${rows.length} catalogued models computed a value for this run.`}>
      {rows.length === 0 ? (
        <div className="mt-2"><Withheld reason="The run recorded no model results." /></div>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 font-medium">Model</th>
              <th className="py-1 font-medium">Role</th>
              <th className="py-1 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ result: r, label, category, lifecycle }) => (
              <tr key={`${r.modelId}-${r.caseId ?? ""}`} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2">{label}{r.caseId ? <span className="text-xs text-slate-500"> · {r.caseId}</span> : null}</td>
                <td className="py-1 pr-2 text-xs text-slate-500">{category}{lifecycle !== "production" ? ` · ${lifecycle}` : ""}</td>
                <td className="py-1 text-right tabular-nums">
                  {r.status === "computed"
                    ? r.perShare != null
                      ? formatPerShare(r.perShare)
                      : r.equityValue != null ? `₹${crore(r.equityValue)} Cr` : <Withheld reason="Computed without a per-share or equity value." />
                    : <Withheld reason={`${r.status}: ${r.reasonCode}`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CostOfCapital({ cc }: { cc: CommandCenter }) {
  const c = cc.costOfCapital;
  return (
    <Card title="Cost of capital" note={`Status: ${c.status}. kw is derived from the capital structure and is not an input (S-9.4C).`}>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Cost of equity (ke)", percent(c.ke)],
          ["Operating capital charge (kw)", percent(c.kw)],
          ["Risk-free rate", percent(c.riskFreeRate)],
          ["Equity risk premium", percent(c.equityRiskPremium)],
          ["Beta", c.beta != null ? c.beta.toFixed(2) : null],
          ["Equity weight", percent(c.weights.equityWeight)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-medium">{value ?? <Withheld reason="Not part of this cost-of-capital build." />}</dd>
          </div>
        ))}
      </dl>
      {c.evidence.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-medium">Input</th>
              <th className="py-1 font-medium">Source</th>
              <th className="py-1 font-medium">As of</th>
              <th className="py-1 font-medium">Provenance</th>
            </tr>
          </thead>
          <tbody>
            {c.evidence.map((e, i) => (
              <tr key={`${e.component}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2">{e.component}</td>
                <td className="py-1 pr-2">{e.source}</td>
                <td className="py-1 pr-2">{e.asOf ?? "undated"}</td>
                <td className="py-1">{e.tier ?? "not tiered"}{e.fallbackReason ? ` — ${e.fallbackReason}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
          {c.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </Card>
  );
}

function Sensitivity({ cc }: { cc: CommandCenter }) {
  // The run's command center is deeply readonly; revalueBase only reads it.
  const input = cc as unknown as RevalueInput;
  const grid = useMemo(
    () => SENSITIVITY_KE.map((ke) => SENSITIVITY_G.map((g) => revalueBase(input, { ke, g }))),
    [input],
  );
  const base = grid[2]![2]!;
  return (
    <Card title="Sensitivity" note="Base-case value per share as the cost of equity (rows) and terminal growth (columns) move; kw follows ke structurally.">
      <table className="mt-2 text-sm">
        <thead>
          <tr className="text-right text-xs text-slate-500">
            <th className="py-1 pr-3 text-left font-medium">ke \ g</th>
            {SENSITIVITY_G.map((g) => <th key={g} className="px-2 py-1 font-medium">{percent(base.g + g)}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, i) => (
            <tr key={SENSITIVITY_KE[i]} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
              <th scope="row" className="py-1 pr-3 text-left text-xs font-medium text-slate-500">{percent(base.ke + SENSITIVITY_KE[i]!)}</th>
              {row.map((cell, j) => (
                <td key={SENSITIVITY_G[j]} className={`px-2 py-1 ${i === 2 && j === 2 ? "font-semibold" : ""}`}>
                  {cell?.value != null ? formatPerShare(cell.value) : <span className="text-xs text-slate-400" title="Terminal growth at or above the discount rate">n/a</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
