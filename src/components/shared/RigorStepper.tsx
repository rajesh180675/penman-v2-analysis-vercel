/**
 * RigorStepper — persistent 5-node rigor ladder visual.
 * The product's core differentiator gets a glanceable home in Zone A.
 *
 * Nodes: Valid → Reconciled → Plausible → Eligible → Production.
 * Achieved path is lit; the first unachieved node pulses as the blocker.
 */
import { Icon } from "./Icon";

export type RigorLevel =
  | "syntactically-valid"
  | "structurally-reconciled"
  | "economically-plausible"
  | "valuation-eligible"
  | "production-ready";

export interface RigorCheckpointLike {
  level: string;
  label: string;
  achieved: boolean;
  detail?: string | undefined;
}

const NODE_SHORT_LABELS: Record<string, string> = {
  "syntactically-valid": "Valid",
  "structurally-reconciled": "Reconciled",
  "economically-plausible": "Plausible",
  "valuation-eligible": "Eligible",
  "production-ready": "Production",
};

interface RigorStepperProps {
  checkpoints: readonly RigorCheckpointLike[];
  /** Called when a node is clicked — e.g. open the trust panel for that gate */
  onSelect?: ((checkpoint: RigorCheckpointLike) => void) | undefined;
  compact?: boolean | undefined;
}

export function RigorStepper({ checkpoints, onSelect, compact = false }: RigorStepperProps) {
  const firstPendingIdx = checkpoints.findIndex((c) => !c.achieved);

  return (
    <div className="flex items-center" role="list" aria-label="Rigor ladder">
      {checkpoints.map((cp, i) => {
        const isBlocker = i === firstPendingIdx;
        const node = (
          <>
            <span
              className={`flex items-center justify-center rounded-full border font-semibold ${
                compact ? "w-5 h-5 text-[9px]" : "w-6 h-6 text-[10px]"
              } ${
                cp.achieved
                  ? "bg-emerald-500 border-emerald-500 text-white"
                  : isBlocker
                    ? "border-amber-400 text-amber-600 dark:text-amber-400 wb-node-pulse bg-amber-50 dark:bg-amber-950/40"
                    : "wb-border wb-text-3 bg-transparent"
              }`}
            >
              {cp.achieved ? <Icon name="shield-check" size={compact ? 11 : 13} strokeWidth={2.5} /> : i + 1}
            </span>
            {!compact && (
              <span
                className={`mt-1 text-[10px] font-medium whitespace-nowrap ${
                  cp.achieved ? "text-emerald-700 dark:text-emerald-400" : isBlocker ? "text-amber-700 dark:text-amber-400" : "wb-text-3"
                }`}
              >
                {NODE_SHORT_LABELS[cp.level] ?? cp.label}
              </span>
            )}
          </>
        );
        return (
          <div key={cp.level} className="flex items-center" role="listitem">
            <button
              type="button"
              onClick={onSelect ? () => onSelect(cp) : undefined}
              title={`${cp.label} — ${cp.achieved ? "achieved" : "not achieved"}${cp.detail ? `\n${cp.detail}` : ""}`}
              className={`flex flex-col items-center ${onSelect ? "cursor-pointer" : "cursor-default"}`}
              aria-label={`${cp.label}: ${cp.achieved ? "achieved" : "not achieved"}`}
            >
              {node}
            </button>
            {i < checkpoints.length - 1 && (
              <span
                className={`${compact ? "w-4" : "w-8"} h-0.5 mx-1 ${compact ? "" : "mb-4"} rounded ${
                  cp.achieved && checkpoints[i + 1]?.achieved
                    ? "bg-emerald-400"
                    : "bg-slate-200 dark:bg-slate-700"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
