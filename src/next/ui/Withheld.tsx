/**
 * A value the analysis deliberately does not show, with the reason. Never a
 * greyed number or a bare "—": a reader must be able to tell "not computed
 * because…" from "zero" or "loading" (docs/ui-revamp-plan.md, pattern 4).
 */
export function Withheld({ reason }: { reason: string }) {
  return (
    <span className="inline-flex flex-col">
      <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Withheld</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{reason}</span>
    </span>
  );
}
