import type { BankPeriodMetrics } from "../bankPipeline";
import { computeBankValuation } from "../bankValuation/computeBankValuation";
import type { SuppliedMarketPacks } from "../marketPacks/activePacks";
import { DEFAULT_CONFIG, type LendingArmPeriod } from "../types";
import { usableArmFilings } from "./carveOut";
import type { ArmFiling, LendingArmLink } from "./links";

/** The parent's stake in its lending arm at one period end, ₹ crore. */
export interface ArmStakeValuation {
  readonly periodEnd: string;
  /** The arm's owners' book equity, from its own filing for the year where there is one. */
  readonly armBookEquity: number;
  /** The arm's owners' equity value: the median of the lender models that computed, or null when none did. */
  readonly armValue: number | null;
  readonly models: readonly string[];
  /** The arm's own filed years the value rests on. */
  readonly filedYears: readonly string[];
  /** The arm's cost of equity, when it was valued. */
  readonly ke: number | null;
  /** The parent's stake at the arm's value, or at its book when no lender model computed. */
  readonly stakeValue: number;
  readonly basis: "lender-valuation" | "book";
}

const DAY_MS = 86_400_000;

/**
 * The arm as a lender, from its own filed accounts: owners' equity and
 * profit, and their ROE. Division III filings give no interest lines or
 * capital ratios, so the book-equity models value it (justified P/B, equity
 * residual income, sustainable DDM) and the NBFC lenses that need those lines
 * stay off. The parent's segment note is not used here: Grasim's carries
 * ₹16k Cr of its own consolidation excess on Aditya Birla Capital, which is
 * not the arm's equity and would understate its ROE.
 */
function lenderMetrics(filings: readonly ArmFiling[]): BankPeriodMetrics[] {
  const filed = filings.filter((f) => f.lenderBalanceSheet != null);
  const ownersShares = filed.flatMap((f) => {
    const bs = f.lenderBalanceSheet!;
    const equity = bs.financialAssets + bs.nonFinancialAssets - bs.financialLiabilities - bs.nonFinancialLiabilities;
    return bs.ownersEquity != null && equity > 0 ? [bs.ownersEquity / equity] : [];
  });
  const ownersShare = ownersShares.length ? ownersShares.at(-1)! : 1;
  let previous: { readonly fiscalYearEnd: string; readonly equity: number } | null = null;
  return filed.map((f): BankPeriodMetrics => {
    const bs = f.lenderBalanceSheet!;
    const assets = bs.financialAssets + bs.nonFinancialAssets;
    const equity = bs.ownersEquity ?? (assets - bs.financialLiabilities - bs.nonFinancialLiabilities) * ownersShare;
    const profit = f.headline.profitAttributableToOwners
      ?? (f.headline.profitAfterTax != null ? f.headline.profitAfterTax * ownersShare : null);
    // Average equity only across consecutive years: a missing year (M&M
    // Financial's FY21 filing carries no balance sheet) takes the closing book.
    const consecutive = previous != null && Math.abs((Date.parse(f.fiscalYearEnd) - Date.parse(previous.fiscalYearEnd)) / DAY_MS - 365.5) < 2;
    const base = consecutive ? (previous!.equity + equity) / 2 : equity;
    previous = { fiscalYearEnd: f.fiscalYearEnd, equity };
    return {
      period_end: f.fiscalYearEnd,
      totalAssets: assets,
      totalEquity: equity,
      advances: bs.loans,
      deposits: null,
      investments: null,
      borrowings: bs.financialLiabilities - bs.payables,
      cashAndBalanceWithRBI: null,
      interestEarned: null,
      interestExpended: null,
      nii: null,
      otherIncome: null,
      operatingExpenses: null,
      provisions: null,
      pat: profit,
      pbt: f.headline.profitBeforeTax,
      dividendPaid: null,
      nim: null,
      roa: null,
      roe: profit != null && base > 0 ? profit / base : null,
      creditCost: null,
      costToIncome: null,
      casaRatio: null,
      nonConvertibleDebentures: null,
      termLoansFromBanks: null,
      termLoansFromInstitutions: null,
      termLoansFromOthers: null,
      leverage: null,
      costOfBorrowings: null,
      yieldOnAdvances: null,
      spread: null,
      debtMix: null,
      quality: null,
    };
  });
}

/**
 * The parent's stake in the arm at each carved period, valued on the arm's own
 * filings up to that year end. The arm is a listed NBFC, so its cost of
 * equity is the NBFC one (company type "nbfc", its own NSE symbol for a
 * pinned beta) from the engine defaults: the parent's capital-cost settings
 * describe the parent, not the lender. Where no lender model computes (too
 * few filed years), the stake is carried at the arm's book.
 */
export function valueArmStake(params: {
  readonly arm: readonly LendingArmPeriod[];
  readonly link: LendingArmLink;
  readonly packs?: SuppliedMarketPacks | undefined;
  readonly asOf?: string | null | undefined;
}): ArmStakeValuation[] {
  const { arm, link } = params;
  const stake = link.stake.fraction;
  const metrics = lenderMetrics(usableArmFilings(link.filings, params.asOf));
  const config = { ...DEFAULT_CONFIG, company_type: "nbfc" as const, ticker: link.arm.nseSymbol };
  return arm.map((a) => {
    const history = metrics.filter((m) => m.period_end <= a.periodEnd);
    // Valued only at a year end the arm filed: an earlier filing would date
    // the stake before the parent's balance sheet it sits beside.
    const filedThisYear = history.at(-1)?.period_end === a.periodEnd;
    const bundle = filedThisYear ? computeBankValuation(history, config, null, null, false, false, params.packs) : null;
    // Without a filing for the year, the owners' part of the equity carved out.
    const armBookEquity = (filedThisYear ? history.at(-1)!.totalEquity : null) ?? (a.assets - a.liabilities) * (a.parentShare / stake);
    const armValue = bundle?.triangulatedValue != null && Number.isFinite(bundle.triangulatedValue) ? bundle.triangulatedValue : null;
    return {
      periodEnd: a.periodEnd,
      armBookEquity,
      armValue,
      models: bundle?.modelsContributing ?? [],
      filedYears: filedThisYear ? history.map((m) => m.period_end) : [],
      ke: bundle?.ke ?? null,
      stakeValue: stake * (armValue ?? armBookEquity),
      basis: armValue != null ? "lender-valuation" : "book",
    };
  });
}
