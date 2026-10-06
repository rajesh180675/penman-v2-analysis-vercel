import { computeRatios, computeResidualIncome } from "../PenmanNissimEngine";
import { resolveCostOfCapitalFromConfig } from "../costOfCapital";
import type { SegmentData } from "../segmentParser";
import type { CanonicalBalanceSheet, EngineConfig, LendingArmPeriod, RecastPeriod } from "../types";
import type { ArmFiling, LendingArmLink } from "./links";

/**
 * The parent's own lines for an insurance business inside the arm, which the
 * industrial recast holds as operating: "Investments of Life Insurance
 * Business" in OA, "Insurance Related Liabilities" in OL (mappingSpec). Only
 * Grasim (Aditya Birla Capital's life insurer) files them.
 */
export interface ArmInsuranceLines {
  readonly investments: number;
  readonly liabilities: number;
}

/** How one filing splits the arm between the recast's operating and financial buckets. */
interface ArmComposition {
  readonly fiscalYearEnd: string;
  readonly filingDate: string;
  /** Share of the arm's assets, outside insurance investments, that the recast holds in FA. */
  readonly financialAssetShare: number;
  /** Share of the arm's liabilities, outside insurance liabilities, that the recast holds in FO. */
  readonly financialObligationShare: number;
  /** Finance cost per rupee of those financial obligations at the year end. */
  readonly financeCostRate: number | null;
  /** Owners' share of the arm's equity; the rest is the arm's own minority. */
  readonly ownersShare: number | null;
  /** The arm's own total assets, to measure the parent's consolidation excess against. */
  readonly assets: number;
}

export type LendingArmCarveOut =
  | {
    readonly status: "applied";
    /** The parent's periods without the arm, from the first one that can be carved. */
    readonly periods: RecastPeriod[];
    readonly arm: LendingArmPeriod[];
    /** Parent periods that could not be carved, dropped from the front of the series, each with why. */
    readonly droppedPeriods: string[];
    readonly notes: string[];
  }
  | { readonly status: "not-applied"; readonly reason: string };

const fiscalLabel = (periodEnd: string) => `FY${periodEnd.slice(0, 4)}`;
const yearsApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / (365.25 * 86_400_000);
const clampShare = (value: number) => Math.min(1, Math.max(0, value));

/** The latest filing for each fiscal year among those filed by the as-of date. */
export function usableArmFilings(filings: readonly ArmFiling[], asOf: string | null | undefined): ArmFiling[] {
  const cutoff = asOf ? asOf.slice(0, 10) : null;
  const byYear = new Map<string, ArmFiling>();
  for (const filing of filings) {
    if (cutoff && filing.filingDate.slice(0, 10) > cutoff) continue;
    const held = byYear.get(filing.fiscalYearEnd);
    if (!held || filing.filingDate > held.filingDate) byYear.set(filing.fiscalYearEnd, filing);
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYearEnd.localeCompare(b.fiscalYearEnd));
}

function compositionOf(filing: ArmFiling, insurance: ArmInsuranceLines): ArmComposition | null {
  const bs = filing.lenderBalanceSheet;
  if (!bs) return null;
  const assets = bs.financialAssets + bs.nonFinancialAssets;
  const liabilities = bs.financialLiabilities + bs.nonFinancialLiabilities;
  // An industrial recast holds cash, bank balances, investments, derivatives
  // and other financial assets in FA; loans and receivables are operating.
  // Borrowings, debt securities, deposits, subordinated and other financial
  // liabilities are FO; payables and non-financial liabilities are OL.
  const heldAsFinancialAssets = bs.financialAssets - bs.loans - bs.receivables - insurance.investments;
  const heldAsFinancialObligations = bs.financialLiabilities - bs.payables - insurance.liabilities;
  const assetBase = assets - insurance.investments;
  const liabilityBase = liabilities - insurance.liabilities;
  if (!(assetBase > 0) || !(liabilityBase > 0) || !(heldAsFinancialObligations > 0)) return null;
  const financeCosts = filing.headline.financeCosts;
  const equity = assets - liabilities;
  return {
    fiscalYearEnd: filing.fiscalYearEnd,
    filingDate: filing.filingDate,
    financialAssetShare: clampShare(heldAsFinancialAssets / assetBase),
    financialObligationShare: clampShare(heldAsFinancialObligations / liabilityBase),
    financeCostRate: financeCosts != null && financeCosts > 0 ? financeCosts / heldAsFinancialObligations : null,
    ownersShare: bs.ownersEquity != null && equity > 0 ? clampShare(bs.ownersEquity / equity) : null,
    assets,
  };
}

/** The item nearest the period, ties to the earlier one. */
function nearest<T extends { readonly fiscalYearEnd: string }>(periodEnd: string, items: readonly T[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (!best || yearsApart(item.fiscalYearEnd, periodEnd) < yearsApart(best.fiscalYearEnd, periodEnd)) best = item;
  }
  return best;
}

interface ArmTotals {
  readonly source: LendingArmPeriod["source"];
  readonly assets: number;
  readonly liabilities: number;
  readonly revenue: number;
  readonly profitBeforeTax: number;
  readonly depreciation: number;
  readonly capex: number;
}

function segmentTotals(periodEnd: string, segmentData: SegmentData | null, segmentName: string): ArmTotals | null {
  const row = segmentData?.data[segmentName]?.[fiscalLabel(periodEnd)];
  if (!row || row.assets == null || row.liabilities == null || row.result == null || row.revenue == null) return null;
  if (!(row.assets > 0)) return null;
  return {
    source: "parent-segment",
    assets: row.assets,
    liabilities: row.liabilities,
    revenue: row.revenue,
    profitBeforeTax: row.result,
    depreciation: row.depreciation ?? 0,
    capex: row.capex ?? 0,
  };
}

function filingTotals(periodEnd: string, filings: readonly ArmFiling[]): ArmTotals | null {
  const filing = filings.find((f) => f.fiscalYearEnd === periodEnd);
  const bs = filing?.lenderBalanceSheet;
  if (!filing || !bs || filing.headline.revenue == null || filing.headline.profitBeforeTax == null) return null;
  return {
    source: "arm-filing",
    assets: bs.financialAssets + bs.nonFinancialAssets,
    liabilities: bs.financialLiabilities + bs.nonFinancialLiabilities,
    revenue: filing.headline.revenue,
    profitBeforeTax: filing.headline.profitBeforeTax,
    depreciation: 0,
    capex: 0,
  };
}

type ArmAmounts = Omit<LendingArmPeriod, "cashFromOperations">;

/**
 * Take a consolidated lending arm out of its industrial parent's recast.
 *
 * The arm's totals are the parent's own segment note (assets, liabilities,
 * result, revenue): what the consolidated statements carry for it. A
 * financial-services segment reports its result after interest, so it is the
 * arm's profit before tax (L&T FY24: 3,028 against L&T Finance's 3,029). The
 * arm's own filings split the totals between the recast's buckets and price
 * its interest; the nearest filed year serves the years before its filings.
 * A year the segment note does not reach (L&T's FY26 export ends its segments
 * at FY25) takes the arm's own results, whose liabilities match the segment's
 * to 0.5% wherever both exist.
 *
 * What the arm leaves behind is the industrial business: its NOA, NFO, OI and
 * NFE, and the minority's claim on the industrial subsidiaries. The parent's
 * stake in the arm is valued separately (armValuation.ts).
 *
 * The carved series is a suffix of the run: a series carved in some years and
 * not others would read the arm's exit as a collapse in assets and sales. So
 * the years that cannot be carved — before the arm's segment exists (Grasim
 * before the Aditya Birla Nuvo merger, FY18), or where removing it leaves a
 * negative balance (M&M's pre-Ind AS years hold almost nothing in FA) — are
 * dropped from the front, each with its reason.
 */
export function carveOutLendingArm(params: {
  readonly periods: readonly RecastPeriod[];
  readonly segmentData: SegmentData | null;
  readonly link: LendingArmLink;
  /** The parent's insurance lines per period end, read from its raw statements. */
  readonly insuranceLines: ReadonlyMap<string, ArmInsuranceLines>;
  readonly config: EngineConfig;
  readonly asOf?: string | null | undefined;
}): LendingArmCarveOut {
  const { periods, segmentData, link, insuranceLines, config } = params;
  if (periods.length === 0) return { status: "not-applied", reason: "No recast periods to carve." };
  const filings = usableArmFilings(link.filings, params.asOf);
  const noInsurance: ArmInsuranceLines = { investments: 0, liabilities: 0 };
  // An arm with an insurer can only be split in a year the parent's own
  // insurance lines are known; a parent that files none has none.
  const parentFilesInsurance = [...insuranceLines.values()].some((lines) => lines.investments > 0 || lines.liabilities > 0);
  const compositions = filings.flatMap((filing) => {
    const insurance = insuranceLines.get(filing.fiscalYearEnd) ?? (parentFilesInsurance ? null : noInsurance);
    const composition = insurance ? compositionOf(filing, insurance) : null;
    return composition ? [composition] : [];
  });
  if (compositions.length === 0) {
    return { status: "not-applied", reason: `No filing of ${link.arm.name} by the as-of date splits its balance sheet.` };
  }
  const withRate = compositions.filter((c) => c.financeCostRate != null);
  const withOwners = compositions.filter((c) => c.ownersShare != null);
  // The segment's assets above the arm's own, measured where both exist.
  const excesses = compositions.flatMap((c) => {
    const segment = segmentTotals(c.fiscalYearEnd, segmentData, link.segmentName);
    return segment ? [{ fiscalYearEnd: c.fiscalYearEnd, excess: Math.max(0, segment.assets - c.assets) }] : [];
  });

  const amountsFor = (periodEnd: string, taxRate: number): ArmAmounts | string => {
    const totals = segmentTotals(periodEnd, segmentData, link.segmentName) ?? filingTotals(periodEnd, filings);
    if (!totals) return `no ${link.segmentName} segment and no filing of ${link.arm.name}`;
    const insurance = insuranceLines.get(periodEnd) ?? noInsurance;
    const composition = nearest(periodEnd, compositions)!;
    const financeCostRate = nearest(periodEnd, withRate)?.financeCostRate;
    if (financeCostRate == null) return `no filing of ${link.arm.name} prices its finance cost`;
    const financialAssets = composition.financialAssetShare * Math.max(0, totals.assets - insurance.investments);
    const financialObligations = composition.financialObligationShare * Math.max(0, totals.liabilities - insurance.liabilities);
    const operatingAssets = totals.assets - financialAssets;
    const t = Math.min(Math.max(taxRate, 0), 0.5);
    return {
      periodEnd,
      source: totals.source,
      assets: totals.assets,
      liabilities: totals.liabilities,
      revenue: totals.revenue,
      profitBeforeTax: totals.profitBeforeTax,
      depreciation: totals.depreciation,
      capex: totals.capex,
      financialAssets,
      operatingAssets,
      consolidationExcess: totals.source === "parent-segment"
        ? Math.min(nearest(periodEnd, excesses)?.excess ?? 0, operatingAssets)
        : 0,
      financialObligations,
      operatingLiabilities: totals.liabilities - financialObligations,
      financeCost: financeCostRate * financialObligations,
      taxRate: t,
      profitAfterTax: totals.profitBeforeTax * (1 - t),
      parentShare: link.stake.fraction * (nearest(periodEnd, withOwners)?.ownersShare ?? 1),
      composition: { fiscalYearEnd: composition.fiscalYearEnd, filingDate: composition.filingDate },
    };
  };

  // A year is carvable when the arm's data reaches it and removing the arm
  // leaves no negative balance; the cash flow does not affect either test.
  const amounts = periods.map((period) => amountsFor(period.period_end, period.is.taxRate));
  const blockers = periods.map((period, i) => {
    const amount = amounts[i]!;
    if (typeof amount === "string") return amount;
    const removed = removeArm(period, { ...amount, cashFromOperations: 0 });
    return typeof removed === "string" ? removed : null;
  });
  let first = periods.length;
  while (first > 0 && blockers[first - 1] == null) first -= 1;
  if (first === periods.length) {
    return { status: "not-applied", reason: `${periods.at(-1)!.period_end}: ${blockers.at(-1)}.` };
  }

  const notes: string[] = [];
  const arm: LendingArmPeriod[] = [];
  const carved: RecastPeriod[] = [];
  const ke = resolveCostOfCapitalFromConfig({ config }).ke;
  const netOperating = (a: ArmAmounts) => a.operatingAssets - a.operatingLiabilities;
  for (let i = first; i < periods.length; i += 1) {
    const period = periods[i]!;
    const base = amounts[i] as ArmAmounts;
    // The arm's operating cash flow follows from its own balance sheets, so
    // the carved CFO and the carved growth in NOA describe one business.
    const previous = i > first ? (amounts[i - 1] as ArmAmounts) : null;
    if (!previous) notes.push(`${period.period_end}: no prior carved year, so ${link.arm.name}'s operating cash flow is its profit plus depreciation.`);
    const amount: LendingArmPeriod = {
      ...base,
      cashFromOperations: base.profitAfterTax + base.depreciation - (previous ? netOperating(base) - netOperating(previous) : 0),
    };
    const next = removeArm(period, amount) as RecastPeriod;
    const prev = carved.at(-1);
    if (prev) {
      const capitalCost = resolveCostOfCapitalFromConfig({ config, current: next, previous: prev });
      next.kwStructural = capitalCost.kw;
      next.kwUsed = capitalCost.kw;
      next.ratios = computeRatios(next, prev, config);
      next.ri = computeResidualIncome(next, prev, ke, capitalCost.kw);
      const dNOA = next.bs.NOA - prev.bs.NOA;
      const fcfAccounting = next.is.OI - dNOA;
      const dtFormula = fcfAccounting - next.is.NFE + (next.bs.NFO - prev.bs.NFO);
      next.cf = { ...next.cf, FCF_accounting: fcfAccounting, d_t_formula: dtFormula, d_t_discrepancy: next.cf.d_t - dtFormula };
    } else {
      // The first carved period has no carved predecessor: like the pipeline's
      // first period, it carries no ratios and no flows measured on a change.
      next.ratios = undefined;
      next.ri = undefined;
      next.kwStructural = null;
      next.kwUsed = null;
      next.cf = { ...next.cf, FCF_accounting: 0, d_t_formula: 0, d_t_discrepancy: 0 };
    }
    arm.push(amount);
    carved.push(next);
  }
  return {
    status: "applied",
    periods: carved,
    arm,
    droppedPeriods: periods.slice(0, first).map((p, i) => `${p.period_end}: ${blockers[i] ?? "precedes a year that cannot be carved"}`),
    notes,
  };
}

type OperatingAssetBucket = "OA_Other" | "OA_Goodwill" | "OA_OtherIntangibles";

/** Take an amount from the buckets in order, none below zero; returns what could not be taken. */
function takeFromBuckets(bs: CanonicalBalanceSheet, amount: number, order: readonly OperatingAssetBucket[]): number {
  let left = amount;
  for (const key of order) {
    const taken = Math.min(Math.max(bs[key], 0), left);
    bs[key] -= taken;
    if (key === "OA_Goodwill") bs.Goodwill = Math.max(0, bs.Goodwill - taken);
    left -= taken;
  }
  return left;
}

/** One period without the arm, or why it cannot be carved. */
function removeArm(period: RecastPeriod, arm: LendingArmPeriod): RecastPeriod | string {
  const bs = { ...period.bs };
  const equity = arm.assets - arm.liabilities;
  const parentEquity = arm.parentShare * equity;
  // The parent's consolidation excess sits with goodwill and intangibles
  // (Grasim files its goodwill inside "Intangible Assets"); the arm's loans and
  // an insurer's investments sit in the unitemized operating assets.
  const excessLeft = takeFromBuckets(bs, arm.consolidationExcess, ["OA_Goodwill", "OA_OtherIntangibles"]);
  const left = takeFromBuckets(bs, arm.operatingAssets - arm.consolidationExcess + excessLeft, ["OA_Other", "OA_Goodwill", "OA_OtherIntangibles"]);
  if (left > 1) {
    return `the arm's operating assets exceed the parent's unitemized, goodwill and intangible assets by ${left.toFixed(0)} Cr`;
  }
  bs.TA -= arm.assets;
  bs.OA -= arm.operatingAssets;
  bs.FA -= arm.financialAssets;
  bs.OL -= arm.operatingLiabilities;
  bs.FO -= arm.financialObligations;
  if (bs.FO_FinancialDebtExLease != null) bs.FO_FinancialDebtExLease -= arm.financialObligations;
  bs.NOA = bs.OA - bs.OL;
  bs.NFO = bs.FO - bs.FA;
  bs.CSE -= parentEquity;
  bs.MI -= equity - parentEquity;
  if (bs.FA < -1 || bs.FO < -1 || bs.OL < -1 || bs.MI < -1) {
    return `removing the arm leaves a negative balance (FA ${bs.FA.toFixed(0)}, FO ${bs.FO.toFixed(0)}, OL ${bs.OL.toFixed(0)}, MI ${bs.MI.toFixed(0)})`;
  }

  const t = arm.taxRate;
  const operatingIncome = (arm.profitBeforeTax + arm.financeCost) * (1 - t);
  const financingExpense = arm.financeCost * (1 - t);
  const parentProfit = arm.parentShare * arm.profitAfterTax;
  const minorityProfit = arm.profitAfterTax - parentProfit;
  const is = {
    ...period.is,
    Sales: period.is.Sales - arm.revenue,
    OI: period.is.OI - operatingIncome,
    OI_from_sales: period.is.OI_from_sales - operatingIncome,
    FinanceCost: period.is.FinanceCost - arm.financeCost,
    NFE: period.is.NFE - financingExpense,
    TaxExpense: period.is.TaxExpense - arm.profitBeforeTax * t,
    PAT: period.is.PAT - arm.profitAfterTax,
    CNI: period.is.CNI - parentProfit,
    TCI: period.is.TCI - parentProfit,
    MII: period.is.MII - minorityProfit,
    TCI_NCI: period.is.TCI_NCI - minorityProfit,
    operatingCostBridge: period.is.operatingCostBridge
      ? {
        ...period.is.operatingCostBridge,
        depreciation: period.is.operatingCostBridge.depreciation - arm.depreciation,
        grossProfit: period.is.operatingCostBridge.grossProfit - arm.revenue,
      }
      : undefined,
  };
  const cu = { ...period.cu, CoreOI: period.cu.CoreOI - operatingIncome, CoreNFE: period.cu.CoreNFE - financingExpense };
  // EBITDA grosses OI up at the period's rate (recast.ts); the arm's part is its
  // profit before interest and tax plus its depreciation.
  const grossUp = period.is.taxRate < 0.5 ? 1 - period.is.taxRate : 1 - Math.min(period.is.taxRate, 0.45);
  const CFO = period.cf.CFO - arm.cashFromOperations;
  const Capex = Math.max(0, period.cf.Capex - arm.capex);
  const cf = {
    ...period.cf,
    CFO,
    Capex,
    FCF_cash: CFO - Capex,
    EBITDA: period.cf.EBITDA - operatingIncome / grossUp - arm.depreciation,
  };
  return { ...period, bs, is, cu, cf, lendingArm: arm };
}
