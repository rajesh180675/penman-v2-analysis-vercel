/**
 * The raw Capitaline lines that could explain a reconciliation residual.
 *
 * Nearly every reconciliation failure found in the library was one filed line
 * the recast did not read, or read with the wrong sign or at the wrong scale:
 * L&T's associates' share (−990.16), NTPC's prior-year adjustments (316.06),
 * TCS's preference capital (100), Titan's cash interest above Other Income,
 * L&T FY18's investment loss (2,217.72). Each residual equalled that line — as
 * filed, or after tax. The line was either never read, or read and then treated
 * wrongly (the investment loss was read, as UFE, but the bridge still deducted it).
 */

export type CandidateStatement = "ProfitLoss" | "CashFlow" | "BalanceSheet";

export interface ResidualCandidate {
  readonly label: string;
  readonly statement: CandidateStatement;
  readonly value: number;
  /** The residual matches the line as filed, or the line after tax (× (1 − tax rate)). */
  readonly basis: "as filed" | "after tax";
  /** The recast traced the line as read: look at its sign, scale or double count rather than a mapping gap. */
  readonly read: boolean;
}

const INCOME_AND_CASH: readonly CandidateStatement[] = ["ProfitLoss", "CashFlow"];

/**
 * Non-zero lines of the given statements (default P&L and cash flow) whose
 * size equals |residual| within 0.25% (at least 0.5), nearest first, with whether
 * the recast traced each as read.
 *
 * `readLabels` holds the label of every line the recast traced, without its
 * statement suffix: the raw data files each line under both `Label` and
 * `Label__Statement`, and a read through either is a read of the line. A line
 * read without a trace is reported as never read, so a candidate is a lead to
 * check, not a proof.
 */
export function findResidualCandidates(input: {
  readonly rawValues: Readonly<Record<string, number>>;
  readonly readLabels: ReadonlySet<string>;
  readonly residual: number;
  readonly taxRate: number;
  readonly statements?: readonly CandidateStatement[];
  readonly limit?: number;
}): ResidualCandidate[] {
  const target = Math.abs(input.residual);
  if (!Number.isFinite(target) || target === 0) return [];
  // Tight on purpose: a real match is exact to the paisa, and with ~100 lines
  // a looser band matches by coincidence (L&T FY18: "Interest Paid" after tax,
  // 1,791 against a residual of 1,781.86, at 1%).
  const tolerance = Math.max(0.5, target * 0.0025);
  const afterTax = 1 - (input.taxRate > 0 && input.taxRate < 1 ? input.taxRate : 0);
  const statements = input.statements ?? INCOME_AND_CASH;

  const found: Array<ResidualCandidate & { readonly gap: number }> = [];
  for (const [key, value] of Object.entries(input.rawValues)) {
    const split = key.lastIndexOf("__");
    if (split < 0 || !Number.isFinite(value) || value === 0) continue;
    const statement = key.slice(split + 2) as CandidateStatement;
    const label = key.slice(0, split);
    if (!statements.includes(statement)) continue;
    for (const [scale, basis] of [[1, "as filed"], [afterTax, "after tax"]] as const) {
      const gap = Math.abs(Math.abs(value) * scale - target);
      if (gap <= tolerance) {
        found.push({ label, statement, value, basis, read: input.readLabels.has(label), gap });
        break;
      }
    }
  }
  return found
    .sort((a, b) => a.gap - b.gap)
    .slice(0, input.limit ?? 5)
    .map(({ gap: _gap, ...candidate }) => candidate);
}
