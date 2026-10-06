import mmfinFilings from "../../../data/filings/M&MFIN/as-filed.json";
import ltfFilings from "../../../data/filings/LTF/as-filed.json";
import abcapitalFilings from "../../../data/filings/ABCAPITAL/as-filed.json";
import type { LenderBalanceSheet } from "../filings/xbrlInstance";

/**
 * An as-filed consolidated annual result of the arm (scripts/filings/
 * fetch-nse-annual.ts), the fields the carve-out reads. ₹ crore.
 */
export interface ArmFiling {
  readonly fiscalYearEnd: string;
  readonly filingDate: string;
  readonly xbrlUrl: string;
  readonly headline: {
    readonly revenue: number | null;
    readonly profitBeforeTax: number | null;
    readonly profitAfterTax: number | null;
    readonly profitAttributableToOwners: number | null;
    readonly financeCosts: number | null;
  };
  readonly lenderBalanceSheet?: LenderBalanceSheet | undefined;
}

/**
 * A listed lending arm consolidated into an industrial parent. Its loans sit in
 * the parent's operating assets, its borrowings in the parent's financial
 * obligations and its interest in the parent's financing expense, so the
 * parent's RNOA, turnover and leverage describe a lender and a manufacturer at
 * once. The carve-out takes the arm out and values it on its own.
 */
export interface LendingArmLink {
  /** The parent's ticker in the company registry. */
  readonly parentTicker: string;
  /** The parent's business segment that reports the arm, as Capitaline names it. */
  readonly segmentName: string;
  readonly arm: { readonly name: string; readonly nseSymbol: string };
  /** The parent's share of the arm's owners' equity, as filed in a shareholding disclosure. */
  readonly stake: { readonly fraction: number; readonly asOf: string; readonly source: string };
  readonly filings: readonly ArmFiling[];
}

const records = (ledger: { records: readonly ArmFiling[] }) => ledger.records;

export const LENDING_ARM_LINKS: readonly LendingArmLink[] = [
  {
    parentTicker: "M&M",
    segmentName: "FINANCIAL SERVICES",
    arm: { name: "Mahindra & Mahindra Financial Services", nseSymbol: "M&MFIN" },
    stake: {
      fraction: 0.5216,
      asOf: "2025-03-31",
      source: "Business Standard, 10 Jun 2025: M&M held 52.16% before the June 2025 rights issue (52.49% after)",
    },
    filings: records(mmfinFilings as { records: ArmFiling[] }),
  },
  {
    parentTicker: "LT",
    segmentName: "FINANCIAL SERVICES",
    arm: { name: "L&T Finance", nseSymbol: "LTF" },
    stake: {
      fraction: 0.6624,
      asOf: "2025-03-31",
      source: "Trendlyne, from the NSE shareholding filing for the March 2025 quarter: Larsen & Toubro (promoter) 66.24%",
    },
    filings: records(ltfFilings as { records: ArmFiling[] }),
  },
  {
    parentTicker: "GRASIM",
    segmentName: "FINANCIAL SERVICES",
    arm: { name: "Aditya Birla Capital", nseSymbol: "ABCAPITAL" },
    stake: {
      fraction: 0.5258,
      asOf: "2025-03-31",
      source: "CRISIL rating rationale for Grasim Industries, 30 May 2025: 52.58% of Aditya Birla Capital as on 31 Mar 2025",
    },
    filings: records(abcapitalFilings as { records: ArmFiling[] }),
  },
];

export function findLendingArmLink(ticker: string | null | undefined): LendingArmLink | null {
  return ticker ? LENDING_ARM_LINKS.find((link) => link.parentTicker === ticker) ?? null : null;
}
