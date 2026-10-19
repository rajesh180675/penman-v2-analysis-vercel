/**
 * Source tie-out: does the Capitaline dataset agree with what the company
 * actually filed?
 *
 * Capitaline serves LATEST figures (restated where the company later
 * restated); an exchange XBRL filing is the figure AS FIRST REPORTED. A
 * difference is therefore one of three things — a parser/mapping error, a
 * genuine restatement, or a definitional mismatch — and each is worth knowing
 * before a number reaches a valuation. The one definitional mismatch a filing
 * itemizes, revenue gross of excise duty, is netted before comparing.
 */
import type { RecastPeriod } from "../types";
import type { AnnualHeadline } from "./xbrlInstance";

export type TieOutField = "revenue" | "profitAfterTax" | "totalAssets" | "totalEquity" | "equityAttributableToOwners" | "cashFlowFromOperations";

export const TIE_OUT_FIELDS: readonly TieOutField[] = [
  "revenue",
  "profitAfterTax",
  "totalAssets",
  "totalEquity",
  "equityAttributableToOwners",
  "cashFlowFromOperations",
];

/** Within 0.5% is a match (rounding, crore conversion); within 2% is minor. */
export const MATCH_TOLERANCE = 0.005;
export const MINOR_TOLERANCE = 0.02;

/**
 * `filing-inconsistent`: the as-filed figure contradicts its own filing, so
 * it cannot arbitrate. Asian Paints' FY22 XBRL reports full-year PAT of
 * ₹9,167 Cr beside PBT of ₹4,156 Cr and owners' profit of ₹3,031 Cr —
 * Capitaline's ₹3,085 Cr is the right number.
 */
export type TieOutStatus = "match" | "minor" | "mismatch" | "filing-inconsistent";

/** Internal-consistency failures of one filing's headline, by the fields they discredit. */
export function headlineInconsistencies(headline: Partial<AnnualHeadline>): Map<TieOutField, string> {
  const issues = new Map<TieOutField, string>();
  const { profitBeforeTax: pbt, profitAfterTax: pat, profitAttributableToOwners: owners, totalEquity, equityAttributableToOwners } = headline;
  // PBT is CONTINUING operations only, so compare it with continuing PAT: a
  // discontinued-operations gain legitimately lifts total PAT far above PBT
  // (L&T FY21: ₹4,669 Cr continuing + ₹8,238 Cr discontinued vs PBT ₹8,542 Cr).
  // Without a continuing figure, total PAT stands in only when no
  // discontinued result was reported. A tax credit can lift PAT above PBT,
  // but not to 1.5× it.
  const discontinued = headline.profitFromDiscontinuedOperations;
  const continuingPat = headline.profitFromContinuingOperations
    ?? (discontinued == null || discontinued === 0 ? pat : null);
  if (pbt != null && continuingPat != null && pbt > 0 && continuingPat > 1.5 * pbt) {
    issues.set("profitAfterTax", `continuing PAT ${continuingPat.toFixed(0)} exceeds 1.5× PBT ${pbt.toFixed(0)}`);
  }
  // Owners' + minority = total, where the filing states the minority's share.
  // Without it, a ratio stands in, and that misread a large minority as a
  // contradiction: Grasim FY25 PAT 7,756 = owners 3,706 + minority 4,051;
  // Bharti FY19 1,688 = 410 + 1,278. Asian Paints FY22 fails the identity
  // (3,031 + 54 = 3,085 against a filed 9,167), and Capitaline's 3,085 is right.
  const minorityProfit = headline.profitAttributableToNonControllingInterests ?? null;
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.01 * Math.abs(b));
  // A split filed as 0 and 0 is a blank, not a statement (Vodafone Idea FY19–25,
  // Nestlé FY25): the identity applies only to a split the filing states.
  const splitStated = owners != null && minorityProfit != null && (owners !== 0 || minorityProfit !== 0);
  if (pat != null && owners != null && minorityProfit != null && splitStated) {
    if (!near(owners + minorityProfit, pat)) {
      issues.set("profitAfterTax", `owners' profit ${owners.toFixed(0)} + minority ${minorityProfit.toFixed(0)} = ${(owners + minorityProfit).toFixed(0)}, not PAT ${pat.toFixed(0)}`);
    }
  } else if (pat != null && owners != null && pat > 0 && owners > 0 && (pat > 2 * owners || owners > 2 * pat)) {
    issues.set("profitAfterTax", `PAT ${pat.toFixed(0)} and owners' profit ${owners.toFixed(0)} differ by more than 2×`);
  }
  // A negative minority puts owners' equity above total equity (Paytm FY25:
  // 15,027 − 30 = 14,997), which the ratio test read as a contradiction.
  const minorityEquity = headline.nonControllingInterest ?? null;
  if (totalEquity != null && equityAttributableToOwners != null && minorityEquity != null) {
    if (!near(equityAttributableToOwners + minorityEquity, totalEquity)) {
      issues.set("equityAttributableToOwners", `owners' equity ${equityAttributableToOwners.toFixed(0)} + minority ${minorityEquity.toFixed(0)} is not total equity ${totalEquity.toFixed(0)}`);
    }
  } else if (totalEquity != null && equityAttributableToOwners != null && equityAttributableToOwners > totalEquity * 1.001 && totalEquity > 0) {
    issues.set("equityAttributableToOwners", `owners' equity exceeds total equity`);
  }
  return issues;
}

export interface TieOutRow {
  readonly fiscalYearEnd: string;
  readonly field: TieOutField;
  readonly asFiled: number;
  readonly capitaline: number;
  /** (capitaline − asFiled) / |asFiled|. */
  readonly relativeDifference: number;
  readonly status: TieOutStatus;
  /**
   * What `asFiled` was netted of to compare like with like: revenue from
   * operations is filed gross of excise duty, Capitaline's revenue is net.
   */
  readonly netOf?: { readonly label: string; readonly value: number } | undefined;
}

export interface AsFiledHeadlineRecord {
  readonly fiscalYearEnd: string;
  readonly filingDate: string;
  readonly headline: AnnualHeadline;
}

function capitalineValue(period: RecastPeriod, field: TieOutField): number | null {
  switch (field) {
    case "revenue": return period.is.Sales;
    // The filing's profit for the period. Capitaline files three of its lines
    // below its own PAT, all inside TCI: extraordinary items after tax (NTPC's
    // regulatory-deferral movement, ₹3,701.92 Cr in FY25), the associates'
    // share after tax, and discontinued operations after tax (ITC FY25:
    // ₹20,036 Cr PAT + ₹15,016 Cr from the demerged hotels = ₹35,052 Cr filed).
    case "profitAfterTax": {
      const bridge = period.is.operatingCostBridge;
      return period.is.PAT + (bridge?.extraordinaryAfterTax ?? 0) + (bridge?.associatesShareAfterTax ?? 0)
        + (period.cu?.DiscontinuedOperationsAfterTax ?? 0);
    }
    case "totalAssets": return period.bs.TA;
    // Ind AS "Equity" is total equity, including non-controlling interests.
    case "totalEquity": return period.bs.CSE + (Number.isFinite(period.bs.MI) ? period.bs.MI : 0);
    case "equityAttributableToOwners": return period.bs.CSE;
    case "cashFlowFromOperations": return period.cf?.CFO ?? null;
  }
}

/**
 * Compare the FIRST filing for each fiscal year (the figure as originally
 * reported) with the Capitaline period for that year-end.
 */
export function tieOutAsFiled(records: readonly AsFiledHeadlineRecord[], periods: readonly RecastPeriod[]): TieOutRow[] {
  const firstFiling = new Map<string, AsFiledHeadlineRecord>();
  for (const record of [...records].sort((a, b) => a.filingDate.localeCompare(b.filingDate))) {
    if (!firstFiling.has(record.fiscalYearEnd)) firstFiling.set(record.fiscalYearEnd, record);
  }
  const rows: TieOutRow[] = [];
  for (const [fiscalYearEnd, record] of firstFiling) {
    const period = periods.find((p) => p.period_end === fiscalYearEnd);
    if (!period) continue;
    const inconsistencies = headlineInconsistencies(record.headline);
    for (const field of TIE_OUT_FIELDS) {
      // Gross revenue less the excise the filing itemizes: Capitaline's revenue
      // is net of it (ITC FY18 ₹47,689 Cr filed − ₹4,240 Cr excise = ₹43,449 Cr).
      const excise = field === "revenue" ? record.headline.exciseDuty ?? null : null;
      const netOf = excise != null && excise > 0 ? { label: "excise duty", value: excise } : undefined;
      const reported = record.headline[field];
      const asFiled = reported != null && netOf ? reported - netOf.value : reported;
      const capitaline = capitalineValue(period, field);
      if (asFiled == null || capitaline == null || !Number.isFinite(capitaline) || asFiled === 0) continue;
      const relativeDifference = (capitaline - asFiled) / Math.abs(asFiled);
      const magnitude = Math.abs(relativeDifference);
      rows.push({
        fiscalYearEnd,
        field,
        asFiled,
        capitaline,
        relativeDifference,
        status: inconsistencies.has(field) ? "filing-inconsistent"
          : magnitude <= MATCH_TOLERANCE ? "match"
          : magnitude <= MINOR_TOLERANCE ? "minor"
          : "mismatch",
        ...(netOf ? { netOf } : {}),
      });
    }
  }
  return rows.sort((a, b) => a.fiscalYearEnd.localeCompare(b.fiscalYearEnd) || a.field.localeCompare(b.field));
}
