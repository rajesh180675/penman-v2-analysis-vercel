/**
 * Where a displayed number comes from (docs/ui-revamp-plan.md, lineage drawer).
 *
 * Statement lines resolve to the recast's own trace — the Capitaline rows (or
 * the derivation) it recorded while building the period — plus, for derived
 * lines, the formula and the component lines to drill into. Ratios resolve to
 * the formula in PenmanNissimEngine/ratiosResidual.ts with this period's and
 * the prior period's operands.
 */
import type { RecastPeriod, TraceEntry } from "../engine/types";

export interface LineDef {
  readonly id: string;
  readonly label: string;
  readonly value: (p: RecastPeriod) => number | null | undefined;
  /** Trace keys; a trailing "*" matches by prefix. */
  readonly trace: readonly string[];
  readonly formula?: string;
  readonly components?: readonly string[];
}

export const INCOME_LINES: readonly LineDef[] = [
  { id: "sales", label: "Sales", value: (p) => p.is.Sales, trace: ["IS.Sales"] },
  { id: "coreOI", label: "Core OI", value: (p) => p.cu?.CoreOI, trace: [], formula: "OI − Unusual OI", components: ["oi", "uoi"] },
  {
    id: "uoi",
    label: "Unusual OI",
    value: (p) => p.cu?.UOI,
    trace: ["IS.ExceptionalPreTax", "IS.ExtraordinaryPreTax", "IS.DiscontinuedRaw", "IS.DiscontinuedTax", "IS.OCI.*"],
    formula: "Exceptional + discontinued items (after tax) + OCI",
  },
  { id: "oi", label: "Operating income (OI)", value: (p) => p.is.OI, trace: ["IS.OI"], formula: "CNI + NFE + MII", components: ["cni", "nfe", "mii"] },
  {
    id: "nfe",
    label: "Net financial expense (NFE)",
    value: (p) => p.is.NFE,
    trace: ["IS.FinanceCost*", "IS.FinanceIncome*", "IS.PreferredDividend"],
    formula: "(Finance cost − finance income) × (1 − tax rate) + preference dividend + unusual financial expense",
  },
  {
    id: "mii",
    label: "Minority interest in income (MII)",
    value: (p) => p.is.MII,
    trace: ["IS.TCI_NCI"],
    formula: "− Capitaline's Non-Controlling Interests line (a signed deduction)",
  },
  {
    id: "cni",
    label: "Comprehensive income to common (CNI)",
    value: (p) => p.is.CNI,
    trace: ["IS.CNI", "IS.TCI", "IS.PreferredDividend"],
    formula: "Owners' TCI − preference dividend",
  },
];

export const BALANCE_LINES: readonly LineDef[] = [
  { id: "oa", label: "Operating assets (OA)", value: (p) => p.bs.OA, trace: ["BS.OA"] },
  { id: "ol", label: "Operating liabilities (OL)", value: (p) => p.bs.OL, trace: ["BS.OL"] },
  { id: "noa", label: "Net operating assets (NOA)", value: (p) => p.bs.NOA, trace: ["BS.NOA"], formula: "OA − OL", components: ["oa", "ol"] },
  { id: "fa", label: "Financial assets (FA)", value: (p) => p.bs.FA, trace: ["BS.FA"] },
  { id: "fo", label: "Financial obligations (FO)", value: (p) => p.bs.FO, trace: ["BS.FO"] },
  { id: "nfo", label: "Net financial obligations (NFO)", value: (p) => p.bs.NFO, trace: ["BS.NFO"], formula: "FO − FA", components: ["fo", "fa"] },
  { id: "mi", label: "Minority interest (MI)", value: (p) => p.bs.MI, trace: ["BS.MI"] },
  { id: "cse", label: "Common equity (CSE)", value: (p) => p.bs.CSE, trace: ["BS.CSE"] },
];

const LINES = new Map([...INCOME_LINES, ...BALANCE_LINES].map((l) => [l.id, l]));

export interface RatioDef {
  readonly id: string;
  readonly label: string;
  readonly value: (p: RecastPeriod) => number | null | undefined;
  readonly formula: string;
  /** Lines entering the formula; `average` means (this year + prior year) / 2. */
  readonly operands: readonly { readonly line: string; readonly average: boolean }[];
}

export const RATIOS: readonly RatioDef[] = [
  { id: "PM", label: "Operating margin (PM)", value: (p) => p.ratios?.PM, formula: "OI ÷ Sales", operands: [{ line: "oi", average: false }, { line: "sales", average: false }] },
  { id: "ATO", label: "Asset turnover (ATO)", value: (p) => p.ratios?.ATO, formula: "Sales ÷ average NOA", operands: [{ line: "sales", average: false }, { line: "noa", average: true }] },
  { id: "RNOA", label: "Return on NOA (RNOA)", value: (p) => p.ratios?.RNOA, formula: "OI ÷ average NOA", operands: [{ line: "oi", average: false }, { line: "noa", average: true }] },
  { id: "NBC", label: "Net borrowing cost (NBC)", value: (p) => p.ratios?.NBC, formula: "NFE ÷ average NFO", operands: [{ line: "nfe", average: false }, { line: "nfo", average: true }] },
  { id: "FLEV", label: "Financial leverage (FLEV)", value: (p) => p.ratios?.FLEV, formula: "NFO ÷ CSE (year end)", operands: [{ line: "nfo", average: false }, { line: "cse", average: false }] },
  {
    id: "SPREAD",
    label: "Spread (RNOA − NBC)",
    value: (p) => p.ratios?.SPREAD,
    formula: "RNOA − NBC",
    operands: [{ line: "oi", average: false }, { line: "noa", average: true }, { line: "nfe", average: false }, { line: "nfo", average: true }],
  },
  { id: "ROCE", label: "Return on common equity (ROCE)", value: (p) => p.ratios?.ROCE, formula: "CNI ÷ average CSE", operands: [{ line: "cni", average: false }, { line: "cse", average: true }] },
];

const RATIO_BY_ID = new Map(RATIOS.map((r) => [r.id, r]));

export type LineageTarget =
  | { readonly kind: "line"; readonly id: string; readonly period: number }
  | { readonly kind: "ratio"; readonly id: string; readonly period: number };

export interface LineageComponent {
  readonly target: LineageTarget;
  readonly label: string;
  readonly value: number | null;
}

export interface Lineage {
  readonly title: string;
  readonly periodEnd: string;
  readonly value: number | null;
  readonly formula: string | null;
  readonly sources: readonly TraceEntry[];
  /** Lines to drill into, with their values. */
  readonly components: readonly LineageComponent[];
}

const finite = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);

function traceEntries(period: RecastPeriod, keys: readonly string[]): TraceEntry[] {
  const trace = period.trace ?? {};
  return keys.flatMap((key) => key.endsWith("*")
    ? Object.entries(trace).filter(([k]) => k.startsWith(key.slice(0, -1))).flatMap(([, entries]) => entries)
    : trace[key] ?? []);
}

/** Resolve a displayed number to its lineage; null for an unknown target. */
export function resolveLineage(periods: readonly RecastPeriod[], target: LineageTarget): Lineage | null {
  const period = periods[target.period];
  if (!period) return null;
  if (target.kind === "line") {
    const line = LINES.get(target.id);
    if (!line) return null;
    return {
      title: line.label,
      periodEnd: period.period_end,
      value: finite(line.value(period)),
      formula: line.formula ?? null,
      sources: traceEntries(period, line.trace),
      components: (line.components ?? []).map((id) => ({
        target: { kind: "line", id, period: target.period },
        label: LINES.get(id)!.label,
        value: finite(LINES.get(id)!.value(period)),
      })),
    };
  }
  const ratio = RATIO_BY_ID.get(target.id);
  if (!ratio) return null;
  const prior = target.period > 0 ? target.period - 1 : null;
  return {
    title: ratio.label,
    periodEnd: period.period_end,
    value: finite(ratio.value(period)),
    formula: ratio.formula,
    sources: [],
    components: ratio.operands.flatMap(({ line, average }): LineageComponent[] => {
      const def = LINES.get(line)!;
      const current: LineageComponent = { target: { kind: "line", id: line, period: target.period }, label: def.label, value: finite(def.value(period)) };
      if (!average || prior == null) return [current];
      return [
        current,
        { target: { kind: "line", id: line, period: prior }, label: `${def.label}, prior year`, value: finite(def.value(periods[prior]!)) },
      ];
    }),
  };
}
