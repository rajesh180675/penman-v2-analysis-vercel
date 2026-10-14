import type { RawPeriodData } from "../types";
import type { FinancialInstitutionSubtype } from "../analysisFamily";
import { extractShareCountInput } from "../PenmanNissimEngine/picking";
import type { BankValuationBundle } from "./types";
import { carryValueToPriceDate, resolveShareCountChange, yearsBetween } from "../valuationCommandCenter/helpers";

/**
 * A financial institution's verdict figures: the headline equity value, per
 * share against the price, and (banks and NBFCs) the three scenarios. The
 * industrial verdict reads the command center; a financial run has none, so
 * these come from its own valuation bundle.
 *
 * The headline is the value the family is valued on: an insurer's embedded
 * value plus value of new business (its book models are sanity brackets); for
 * a bank or NBFC the median of its computed models, as computeBankValuation
 * triangulates. Shares are the period-end paid-up count from the statements,
 * in crore, the basis the industrial market cap uses; ₹ Cr ÷ crore shares is
 * ₹ per share.
 */
export interface FinancialVerdictScenario {
  readonly key: "stress" | "base" | "bull";
  readonly label: string;
  readonly roe: number;
  readonly fairPB: number;
  readonly equityValueCr: number | null;
  /** Per share at the valuation date: beside its fair P/B on that date's book, not the price. */
  readonly perShare: number | null;
}

export interface FinancialVerdict {
  readonly headlineLabel: string;
  readonly equityValueCr: number | null;
  readonly shares: number | null;
  readonly sharesSource: string;
  /** Per share at the valuation date: the latest balance sheet's. */
  readonly perShare: number | null;
  /**
   * Per share carried to the price's date, the one set beside the price: at
   * ke, less the distributions the models' steady state pays, (ROE − g) × book
   * growing at g (Gordon on book: carried a year it is V₀(1 + g), the model's
   * own value a year on). Equals `perShare` when not carried.
   */
  readonly perShareAtPriceDate: number | null;
  readonly marketPrice: number | null;
  readonly marketCapCr: number | null;
  /** The value carried to the price's date over the price, less one; null without both. */
  readonly upside: number | null;
  readonly valuationDate: string | null;
  readonly priceDate: string | null;
  /** Years from the valuation date to the price's; 0 when the value was not carried. */
  readonly yearsToPriceDate: number;
  /** Today's count from the price's quote, in crore; null when it reports none (or an implausible one). */
  readonly sharesAtPriceDate: number | null;
  /** Where sharesAtPriceDate came from ("the price's quote", "the latest annual filing (2026-03-31)"). */
  readonly sharesAtPriceDateSource: string | null;
  /** sharesAtPriceDate / shares; the value beside the price is spread over today's count. */
  readonly shareCountChange: number | null;
  readonly ke: number | null;
  readonly scenarios: readonly FinancialVerdictScenario[];
}

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export function buildFinancialVerdict(input: {
  readonly valuation: BankValuationBundle | null | undefined;
  readonly subtype: FinancialInstitutionSubtype | null | undefined;
  readonly latestRaw: RawPeriodData | null | undefined;
  readonly marketPrice: number | null | undefined;
  /** The price's date (the snapshot's priceAsOf, else when it was fetched). */
  readonly priceDate?: string | null | undefined;
  /** Today's share count, absolute (the snapshot's sharesOutstanding), and where it came from when not the quote. */
  readonly quotedShares?: number | null | undefined;
  readonly quotedSharesSource?: string | null | undefined;
}): FinancialVerdict {
  const { valuation, subtype, latestRaw } = input;
  const insurer = subtype === "insurance";
  const ev = valuation?.evBased;
  const equityValueCr = insurer
    ? (ev?.status === "computed" && finite(ev.intrinsicValue) ? ev.intrinsicValue : null)
    : (finite(valuation?.triangulatedValue) ? valuation!.triangulatedValue : null);

  const shareInput = latestRaw ? extractShareCountInput(latestRaw) : null;
  const shares = finite(shareInput?.endPeriodShares) && shareInput!.endPeriodShares! > 0 ? shareInput!.endPeriodShares! : null;
  const perShareOf = (value: number | null) => (value != null && shares != null ? value / shares : null);
  const perShare = perShareOf(equityValueCr);
  const marketPrice = finite(input.marketPrice) && input.marketPrice > 0 ? input.marketPrice : null;

  // The value is the latest balance sheet's; the price is today's. Set beside
  // it, the value is carried to the price's date first, as an industrial
  // case's is: at ke, less the distributions the models' steady state pays.
  const valuationDate = latestRaw?.period_end ?? null;
  const priceDate = marketPrice != null ? input.priceDate?.slice(0, 10) ?? null : null;
  const book = valuation?.latestBookValue;
  const canCarry = valuationDate != null && priceDate != null && shares != null && finite(book) && finite(valuation?.ke);
  const years = canCarry ? yearsBetween(valuationDate, priceDate) : 0;
  const roe = valuation?.sustainableROE;
  const carriedPerShare = years > 0 && perShare != null && finite(roe)
    ? carryValueToPriceDate(perShare, valuation!.ke, years, Array.from(
        { length: Math.ceil(years) },
        (_, k) => ((roe - valuation!.terminalGrowth) * book! * Math.pow(1 + valuation!.terminalGrowth, k)) / shares!,
      ))
    : perShare;
  // The price is per share of today's count, the value per share of the
  // statements': a bonus or split since would set a value per old share
  // against a price per new one. The quote's own count spreads the value over
  // today's shares; a count outside 0.05–50× the statements' is not one.
  const quotedCr = marketPrice != null && finite(input.quotedShares) && input.quotedShares > 0 ? input.quotedShares / 1e7 : null;
  const shareCountChange = quotedCr != null ? resolveShareCountChange(input.quotedShares, shares) : null;
  const perShareAtPriceDate = carriedPerShare != null && shareCountChange != null ? carriedPerShare / shareCountChange : carriedPerShare;

  const scenarios = insurer
    ? []
    : (valuation?.scenarios?.cards ?? []).map((card) => ({
        key: card.key,
        label: card.label,
        roe: card.roe,
        fairPB: card.fairPB,
        equityValueCr: finite(card.intrinsicValue) ? card.intrinsicValue : null,
        perShare: perShareOf(finite(card.intrinsicValue) ? card.intrinsicValue : null),
      }));

  return {
    headlineLabel: insurer ? "Embedded value + value of new business" : "Median of the financial-institution models",
    equityValueCr,
    shares,
    sharesSource: shares != null ? shareInput!.endPeriodSharesSource : "",
    perShare,
    perShareAtPriceDate,
    marketPrice,
    marketCapCr: marketPrice != null && shares != null ? marketPrice * (shareCountChange != null ? quotedCr! : shares) : null,
    upside: perShareAtPriceDate != null && marketPrice != null ? perShareAtPriceDate / marketPrice - 1 : null,
    valuationDate,
    priceDate,
    yearsToPriceDate: carriedPerShare !== perShare ? years : 0,
    sharesAtPriceDate: shareCountChange != null ? quotedCr : null,
    sharesAtPriceDateSource: shareCountChange != null ? input.quotedSharesSource ?? "the price's quote" : null,
    shareCountChange,
    ke: finite(valuation?.ke) ? valuation!.ke : null,
    scenarios,
  };
}
