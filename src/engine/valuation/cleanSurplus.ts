/* ================================================================
   Plan 5 PR-5.2 — Clean-surplus accounting check.

   Penman & Nissim's clean-surplus relation:
     ΔCommonEquity = ComprehensiveIncome - Dividends + NetStockIssuance

   When this identity holds, every dollar that flows into book value
   first transited the income statement. When it doesn't, the
   "dirty surplus" residual reveals items that bypassed the P&L
   (revaluation reserves, FX translation, certain hedge items, OCI
   that wasn't reported as comprehensive income).

   This module exposes a pure function that walks a recast series,
   computes the per-period residual ratio, and returns a structural
   verdict: "clean" / "minor-dirty" / "material-dirty".

   PR-5.2 ships the checker + tests. Wiring into the rigor ladder
   (so dirty-surplus blocks economically-plausible) is a follow-up.
================================================================ */

export interface CleanSurplusInputs {
  periods: ReadonlyArray<{
    periodEnd: string;
    /** Common shareholders' equity (book value of equity), absolute ₹. */
    commonEquity: number;
    /** Comprehensive income for the period (NI + OCI). Absolute ₹. */
    comprehensiveIncome: number;
    /** Dividends declared during the period. Absolute ₹. Positive number. */
    dividends: number;
    /** Net stock issuance (issuance - buybacks) during the period. Absolute ₹.
     *  Positive when issuing, negative on net buybacks. */
    netStockIssuance: number;
  }>;
  /** Material threshold: residual / |avg BV|. Default 1%. */
  materialThreshold?: number;
  /** Minor threshold: residual / |avg BV|. Default 0.25%. */
  minorThreshold?: number;
}

export interface PeriodCleanSurplusResidual {
  periodEnd: string;
  /** ΔBV - CI + Dividends - NetIssuance. Absolute ₹. */
  residualAbsolute: number;
  /** residualAbsolute / |avgBV|. Decimal. */
  residualRatio: number;
  /** Per-period verdict. */
  status: "clean" | "minor-dirty" | "material-dirty";
}

export type CleanSurplusVerdict = "clean" | "minor-dirty" | "material-dirty";

export interface CleanSurplusResult {
  /** Worst per-period verdict observed (or "clean" when no periods). */
  overall: CleanSurplusVerdict;
  /** P95 of per-period residual ratios (decimal). */
  worstResidualRatio: number;
  /** Per-period detail. */
  perPeriod: PeriodCleanSurplusResidual[];
  /** Number of periods evaluated. First period is skipped (no prior BV). */
  evaluatedPeriods: number;
}

const DEFAULT_MATERIAL_THRESHOLD = 0.01;
const DEFAULT_MINOR_THRESHOLD = 0.0025;

function classifyResidual(
  ratio: number,
  minor: number,
  material: number,
): CleanSurplusVerdict {
  const abs = Math.abs(ratio);
  if (abs >= material) return "material-dirty";
  if (abs >= minor) return "minor-dirty";
  return "clean";
}

function escalate(a: CleanSurplusVerdict, b: CleanSurplusVerdict): CleanSurplusVerdict {
  if (a === "material-dirty" || b === "material-dirty") return "material-dirty";
  if (a === "minor-dirty" || b === "minor-dirty") return "minor-dirty";
  return "clean";
}

export function checkCleanSurplus(inputs: CleanSurplusInputs): CleanSurplusResult {
  const minor = inputs.minorThreshold ?? DEFAULT_MINOR_THRESHOLD;
  const material = inputs.materialThreshold ?? DEFAULT_MATERIAL_THRESHOLD;

  const perPeriod: PeriodCleanSurplusResidual[] = [];
  let overall: CleanSurplusVerdict = "clean";

  for (let i = 1; i < inputs.periods.length; i++) {
    const prev = inputs.periods[i - 1]!;
    const curr = inputs.periods[i]!;
    const deltaBV = curr.commonEquity - prev.commonEquity;
    const expected = curr.comprehensiveIncome - curr.dividends + curr.netStockIssuance;
    const residualAbs = deltaBV - expected;

    const avgBV = 0.5 * (Math.abs(curr.commonEquity) + Math.abs(prev.commonEquity));
    const residualRatio = avgBV > 0 ? residualAbs / avgBV : 0;
    const status = classifyResidual(residualRatio, minor, material);
    overall = escalate(overall, status);

    perPeriod.push({
      periodEnd: curr.periodEnd,
      residualAbsolute: residualAbs,
      residualRatio,
      status,
    });
  }

  // Worst residual = max |ratio|
  const worstRatio = perPeriod.reduce(
    (max, p) => Math.max(max, Math.abs(p.residualRatio)),
    0,
  );

  return {
    overall,
    worstResidualRatio: worstRatio,
    perPeriod,
    evaluatedPeriods: perPeriod.length,
  };
}
