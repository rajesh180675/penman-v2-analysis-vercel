/**
 * ContextHeader — 3-zone canvas "Zone A" for the Workbench UI.
 * Ticker / type / periods / price / verdict / confidence + the rigor stepper.
 * (Moved out of the deleted Primitives.tsx; built on the standalone
 * RigorStepper checkpoint API.)
 */
import { RigorStepper, type RigorCheckpointLike, type RigorLevel } from "./RigorStepper";

interface ContextHeaderProps {
  ticker: string;
  companyType?: string | null | undefined;
  periodCount?: number | undefined;
  latestPeriod?: string | undefined;
  price?: number | null | undefined;
  marketCap?: number | null | undefined;
  rigorCurrent: RigorLevel;
  rigorAchieved: RigorLevel[];
  rigorBlocked?: RigorLevel | null | undefined;
  verdict?: "buy" | "hold" | "avoid" | "insufficient-data" | undefined;
  confidence?: "high" | "medium" | "low" | null | undefined;
}

const VERDICT_STYLES: Record<string, string> = {
  buy: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
  hold: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
  avoid: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800",
  "insufficient-data": "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
};

const RIGOR_ORDER: RigorLevel[] = [
  "syntactically-valid",
  "structurally-reconciled",
  "economically-plausible",
  "valuation-eligible",
  "production-ready",
];

export function ContextHeader({
  ticker,
  companyType,
  periodCount,
  latestPeriod,
  price,
  marketCap,
  rigorCurrent: _rigorCurrent,
  rigorAchieved,
  rigorBlocked,
  verdict,
  confidence,
}: ContextHeaderProps) {
  const checkpoints: RigorCheckpointLike[] = RIGOR_ORDER.map((level) => ({
    level,
    label: level,
    achieved: rigorAchieved.includes(level) && rigorBlocked !== level,
  }));
  return (
    <div className="wb-context-header">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
          <span className="font-bold text-indigo-700 dark:text-indigo-300 text-lg">{ticker.slice(0, 3)}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold wb-text-1">{ticker}</h1>
            {verdict && (
              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full border ${VERDICT_STYLES[verdict]}`}>
                {verdict.toUpperCase().replace("-", " ")}
              </span>
            )}
            {confidence && (
              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${
                confidence === "high"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
                  : confidence === "medium"
                  ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"
                  : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800"
              }`}>
                {confidence} confidence
              </span>
            )}
          </div>
          <p className="text-sm wb-text-2 mt-0.5">
            {companyType ?? "Industrial"}
            {periodCount != null && ` · ${periodCount} periods`}
            {latestPeriod && ` · ${latestPeriod.slice(0, 4)}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        {price != null && (
          <div className="text-right">
            <p className="font-mono text-xl font-bold wb-text-1">₹{price.toFixed(0)}</p>
            <p className="text-xs wb-text-2">{marketCap ? `₹${marketCap.toFixed(0)} Cr MCap` : "Market Price"}</p>
          </div>
        )}
        <RigorStepper checkpoints={checkpoints} />
      </div>
    </div>
  );
}
