/**
 * The lineage drawer: any number → its source rows, formula and components
 * (docs/ui-revamp-plan.md, cross-cutting pattern 1). Components are buttons,
 * so a reader can walk from a ratio down to the Capitaline rows.
 */
import { crore, percent } from "../format";
import type { Lineage, LineageTarget } from "../lineage";
import { Withheld } from "./Withheld";

export function LineageDrawer({
  lineage,
  asPercent,
  onNavigate,
  onClose,
}: {
  lineage: Lineage;
  /** Ratios display as percentages; statement lines as ₹ crore. */
  asPercent: boolean;
  onNavigate: (target: LineageTarget) => void;
  onClose: () => void;
}) {
  const shown = asPercent ? percent(lineage.value) : crore(lineage.value);
  return (
    <aside aria-label="Lineage" className="wb-surface rounded-xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{lineage.title}</h2>
          <p className="text-xs text-slate-500">{lineage.periodEnd}</p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:underline">Close</button>
      </div>
      <p className="mt-2 text-lg font-semibold">
        {shown ?? <Withheld reason="The recast produced no value for this line." />}
        {shown && !asPercent ? <span className="ml-1 text-xs font-normal text-slate-500">₹ Cr</span> : null}
      </p>
      {lineage.formula && (
        <p className="mt-2 text-sm"><span className="text-slate-500">Formula: </span>{lineage.formula}</p>
      )}

      {lineage.components.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400">Built from</h3>
          <ul className="mt-1 space-y-1">
            {lineage.components.map((c) => (
              <li key={`${c.target.id}-${c.target.period}-${c.label}`} className="flex justify-between gap-2 text-sm">
                <button type="button" onClick={() => onNavigate(c.target)} className="text-left text-sky-700 hover:underline dark:text-sky-400">{c.label}</button>
                <span>{crore(c.value) ?? "not reported"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400">Source rows ({lineage.sources.length})</h3>
        {lineage.sources.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">
            {lineage.components.length > 0 ? "Derived — see the lines it is built from." : "No source row was recorded for this line."}
          </p>
        ) : (
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 font-medium">Statement</th>
                <th className="py-1 font-medium">Row</th>
                <th className="py-1 text-right font-medium">Value</th>
                <th className="py-1 font-medium">Match</th>
              </tr>
            </thead>
            <tbody>
              {lineage.sources.map((s, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-2">{s.statement}</td>
                  <td className="py-1 pr-2">{s.key}</td>
                  <td className="py-1 pr-2 text-right">{crore(s.value)}</td>
                  <td className="py-1">{s.matchType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  );
}
