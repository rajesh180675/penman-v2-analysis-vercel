import type { RawPeriodData } from "../types";
import type { FinancialInstitutionSubtype } from "../analysisFamily";
import { extractShareCountInput } from "../PenmanNissimEngine/picking";
import type { BankValuationBundle } from "./types";

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
  readonly perShare: number | null;
}

export interface FinancialVerdict {
  readonly headlineLabel: string;
  readonly equityValueCr: number | null;
  readonly shares: number | null;
  readonly sharesSource: string;
  readonly perShare: number | null;
  readonly marketPrice: number | null;
  readonly marketCapCr: number | null;
  /** Per-share value over the price, less one; null without both. */
  readonly upside: number | null;
  readonly ke: number | null;
  readonly scenarios: readonly FinancialVerdictScenario[];
}

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export function buildFinancialVerdict(input: {
  readonly valuation: BankValuationBundle | null | undefined;
  readonly subtype: FinancialInstitutionSubtype | null | undefined;
  readonly latestRaw: RawPeriodData | null | undefined;
  readonly marketPrice: number | null | undefined;
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
    marketPrice,
    marketCapCr: marketPrice != null && shares != null ? marketPrice * shares : null,
    upside: perShare != null && marketPrice != null ? perShare / marketPrice - 1 : null,
    ke: finite(valuation?.ke) ? valuation!.ke : null,
    scenarios,
  };
}
