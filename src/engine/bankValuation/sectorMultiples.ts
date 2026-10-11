/**
 * A bank's book at its sector index's price-to-book: a market lens on the
 * bank, independent of the residual-income algebra.
 *
 * A bank's justified P/B, equity residual income and DDM are one algebra on
 * book, ROE, ke and growth, so however many of them compute, a bank has one
 * lens (evidence.ts). This one reads none of ROE, ke or growth: it prices the
 * bank's book at the multiple the market paid for its sector on the same date.
 *
 * SOURCING RULES (as for the market packs, indiaMacroPack.ts)
 * 1. Every multiple is a published observation, attributed at the precision a
 *    reviewer could re-fetch it. If one cannot be sourced it is absent, and the
 *    lens is skipped with its reason: it is never estimated.
 * 2. `asOf` is the date the publisher gives for the observation.
 * 3. The multiple is matched to the valuation's anchor, the month-end of the
 *    book it is applied to, never to the run date: today's multiple on an
 *    older book mixes two dates (valuation dating contract), and a later
 *    multiple on an earlier book would be look-ahead.
 *
 * WHICH INDEX
 * Only an index defined on the bank's own NSE basic industry: Nifty Private
 * Bank admits only "basic industry Private Sector Bank" stocks, Nifty PSU Bank
 * only public-sector banks (the factsheets' eligibility criteria). An NBFC has
 * no such index (Nifty Financial Services ex-Bank mixes lenders with insurers,
 * asset managers and exchanges), so no lens.
 *
 * THE BANK IS IN ITS OWN INDEX
 * The index multiple includes the bank's own price at its weight (HDFC Bank
 * about a fifth of Nifty Private Bank, SBI a third of Nifty PSU Bank), so the
 * lens is the market's view of the sector with the bank in it. The weight is
 * disclosed with the lens; it is not an input.
 */
import type { BankValuationModelResult } from "./types";

export interface SectorIndexMultiple {
  /** The index as NSE names it. */
  readonly index: string;
  /** The NSE basic industry the index is defined on. */
  readonly basicIndustry: string;
  /** The date the publisher gives for the observation (YYYY-MM-DD). */
  readonly asOf: string;
  readonly pe: number;
  readonly pb: number;
  readonly source: string;
}

export const SECTOR_INDEX_MULTIPLES: readonly SectorIndexMultiple[] = [
  {
    index: "Nifty Private Bank",
    basicIndustry: "Private Sector Bank",
    asOf: "2025-03-31",
    pe: 15.41,
    pb: 2.24,
    source: "NSE Indices, Index Dashboard, March 31, 2025 (niftyindices.com/Index_Dashboard/Index_Dashboard_MAR2025.pdf): Nifty Private Bank P/E 15.41, P/B 2.24, as on the last trading day of the month",
  },
  {
    index: "Nifty PSU Bank",
    basicIndustry: "Public Sector Bank",
    asOf: "2025-03-31",
    pe: 6.62,
    pb: 1.22,
    source: "NSE Indices, Index Dashboard, March 31, 2025 (niftyindices.com/Index_Dashboard/Index_Dashboard_MAR2025.pdf): Nifty PSU Bank P/E 6.62, P/B 1.22, as on the last trading day of the month",
  },
];

export interface SectorIndexMembership {
  /** The bank's NSE symbol. */
  readonly symbol: string;
  readonly index: string;
  /** Its weight in the index, for disclosure only. */
  readonly weight: number;
  readonly weightAsOf: string;
  readonly source: string;
}

const PRIVATE_BANK_FACTSHEET = "NSE Indices, Nifty Private Bank factsheet, September 30, 2026 (niftyindices.com/Factsheet/ind_nifty_private_bank.pdf), top constituents by weightage";
const PSU_BANK_FACTSHEET = "NSE Indices, Nifty PSU Bank factsheet, September 30, 2026 (niftyindices.com/Factsheet/ind_nifty_psu_bank.pdf), top constituents by weightage";

export const SECTOR_INDEX_MEMBERSHIP: readonly SectorIndexMembership[] = [
  { symbol: "HDFCBANK", index: "Nifty Private Bank", weight: 0.2083, weightAsOf: "2026-09-30", source: PRIVATE_BANK_FACTSHEET },
  { symbol: "ICICIBANK", index: "Nifty Private Bank", weight: 0.2153, weightAsOf: "2026-09-30", source: PRIVATE_BANK_FACTSHEET },
  { symbol: "KOTAKBANK", index: "Nifty Private Bank", weight: 0.1984, weightAsOf: "2026-09-30", source: PRIVATE_BANK_FACTSHEET },
  { symbol: "SBIN", index: "Nifty PSU Bank", weight: 0.3333, weightAsOf: "2026-09-30", source: PSU_BANK_FACTSHEET },
];

const skipped = (reason: string): BankValuationModelResult => ({ status: "skipped", intrinsicValue: null, premiumOverMarket: null, reason, diagnostics: {} });

/**
 * The bank's book at its sector index's P/B on the anchor's month-end.
 * `diagnostics.multipleSourced` is 1: the multiple is a market observation, so
 * the lens counts as independent evidence (evidence.ts).
 */
export function sectorRelativePB(input: {
  readonly symbol: string | null | undefined;
  readonly latestBookValue: number | null | undefined;
  /** The anchor period's end: the date of the book (YYYY-MM-DD). */
  readonly anchorPeriod: string | null | undefined;
  /** The run's analysis date; an observation after it is look-ahead. */
  readonly analysisAsOf?: string | null | undefined;
  readonly marketCap?: number | null | undefined;
  readonly memberships?: readonly SectorIndexMembership[];
  readonly multiples?: readonly SectorIndexMultiple[];
}): BankValuationModelResult {
  const memberships = input.memberships ?? SECTOR_INDEX_MEMBERSHIP;
  const multiples = input.multiples ?? SECTOR_INDEX_MULTIPLES;
  const symbol = input.symbol?.toUpperCase() ?? null;
  const membership = symbol ? memberships.find((m) => m.symbol === symbol) : undefined;
  if (!membership) return skipped(`${symbol ?? "The bank"} is in no NSE index defined on its basic industry that this lens has a sourced multiple for.`);
  const book = input.latestBookValue;
  if (book == null || !Number.isFinite(book) || book <= 0) return skipped("No positive book value to price.");
  const anchor = input.anchorPeriod;
  if (!anchor) return skipped("No anchor period to date the multiple to.");
  const observation = multiples.find((m) => m.index === membership.index && m.asOf.slice(0, 7) === anchor.slice(0, 7));
  if (!observation) {
    return skipped(`No sourced ${membership.index} P/B for the anchor's month (${anchor.slice(0, 7)}); a multiple from another date would price the ${anchor} book at another date's market.`);
  }
  if (input.analysisAsOf && observation.asOf > input.analysisAsOf) {
    return skipped(`The ${membership.index} P/B is dated ${observation.asOf}, after the analysis date ${input.analysisAsOf}; that would be look-ahead.`);
  }
  const value = book * observation.pb;
  const marketCap = input.marketCap;
  return {
    status: "computed",
    intrinsicValue: value,
    premiumOverMarket: marketCap != null && marketCap > 0 ? value / marketCap - 1 : null,
    reason: `Book ₹${Math.round(book).toLocaleString("en-IN")} Cr at ${membership.index}'s ${observation.pb.toFixed(2)}× P/B on ${observation.asOf} (${observation.source}). The index includes the bank itself (${(membership.weight * 100).toFixed(1)}% on ${membership.weightAsOf}).`,
    diagnostics: {
      multipleSourced: 1,
      pbMultiple: observation.pb,
      peMultiple: observation.pe,
      selfWeight: membership.weight,
    },
  };
}
