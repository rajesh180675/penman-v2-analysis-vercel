/**
 * SEADE — utility derivation.
 *
 * Derives UtilityRabCaseInput from parsed financials. Utility inputs are more
 * balance-sheet-driven than telecom: rate base (PPE + CWIP + regulatory
 * deferrals), capital structure, and allowed return are observable or
 * sector-prior-derivable from standard Capitaline exports.
 */
import type { RecastPeriod } from "../types";
import type { EngineConfig } from "../types";
import { ke_from_config } from "../types/config";
import type { UtilityRabCaseInput } from "../sectorCases/contracts";
import { bs, clamp, latestPeriod, prov } from "./derivationUtils";
import type { DerivationProvenance } from "./types";

export interface UtilityDerivationResult {
  readonly input: UtilityRabCaseInput | null;
  readonly provenance: Readonly<Record<string, DerivationProvenance>>;
  readonly missingEvidence: readonly string[];
  readonly reason: string;
}

function deriveRegulatedRateBaseCr(periods: readonly RecastPeriod[]): { value: number | null; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const ppe = bs(latest, "OA_PPE");
  if (ppe != null && ppe > 0) {
    return {
      value: ppe,
      prov: prov(["bs.OA_PPE"], "Regulated rate base ≈ operating PPE", "high"),
    };
  }
  return {
    value: null,
    prov: prov(["bs.OA_PPE"], "Operating PPE unavailable", "low"),
  };
}

function deriveConstructionWorkInProgressCr(periods: readonly RecastPeriod[]): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const cwip = bs(latest, "OA_CWIP");
  if (cwip != null && cwip >= 0) {
    return {
      value: cwip,
      prov: prov(["bs.OA_CWIP"], "Construction work in progress from balance sheet", "high"),
    };
  }
  return {
    value: 0,
    prov: prov(["bs.OA_CWIP"], "No CWIP found; assuming zero", "medium"),
  };
}

function deriveCwipEligibilityPct(): { value: number; prov: DerivationProvenance } {
  // Regulatory policy: not all CWIP is eligible for rate-base inclusion. Use a
  // conservative 50% eligibility (typical for Indian power utilities under
  // CERC regulations where only CWIP meeting specific criteria is allowed).
  return {
    value: 0.5,
    prov: prov([], "Sector prior: 50% CWIP eligibility (CERC-style rate-base rules)", "low", "utility-cwip-eligibility-prior"),
  };
}

function deriveRegulatoryAssetsCr(periods: readonly RecastPeriod[]): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const regulatoryDeferrals = bs(latest, "OA_UtilityRegulatoryDeferrals");
  if (regulatoryDeferrals != null && regulatoryDeferrals >= 0) {
    return {
      value: regulatoryDeferrals,
      prov: prov(["bs.OA_UtilityRegulatoryDeferrals"], "Regulatory deferral account debit balance (regulatory assets)", "high"),
    };
  }
  return {
    value: 0,
    prov: prov(["bs.OA_UtilityRegulatoryDeferrals"], "No regulatory deferrals found; assuming zero", "medium"),
  };
}

function deriveRegulatoryLiabilitiesCr(): { value: number; prov: DerivationProvenance } {
  // Regulatory liabilities (credit balance) are rare in Capitaline exports and
  // typically disclosed separately. When absent, assume zero rather than guess.
  return {
    value: 0,
    prov: prov([], "No regulatory-liability line in standard exports; assuming zero", "medium"),
  };
}

function deriveRegulatedEquityWeight(periods: readonly RecastPeriod[], config: EngineConfig): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const noa = bs(latest, "NOA");
  const cse = bs(latest, "CSE");
  const mi = bs(latest, "MI");
  const nfo = bs(latest, "NFO");
  if (noa != null && noa > 0 && cse != null && mi != null && nfo != null) {
    const equityClaims = cse + mi;
    const weight = equityClaims / noa;
    return {
      value: clamp(weight, 0.1, 0.99),
      prov: prov(["bs.NOA", "bs.CSE", "bs.MI", "bs.NFO"], "Regulated equity weight = (CSE + MI) / NOA (structural)", "high"),
    };
  }
  // Sector prior: utilities typically operate at 50-70% equity weight (rate-base regulation)
  const prior = config.equity_weight != null && config.equity_weight > 0 ? config.equity_weight : 0.60;
  return {
    value: clamp(prior, 0.1, 0.99),
    prov: prov(["config.equity_weight"], "Sector prior: utility equity weight typically 50-70%", "low", "utility-equity-weight-prior"),
  };
}

function deriveAllowedReturnOnEquity(): { value: number; prov: DerivationProvenance } {
  // Regulatory allowed ROE for Indian utilities (CERC/SERC) is typically 14-16%
  // on regulated equity. Use 15% as a central estimate.
  return {
    value: 0.15,
    prov: prov([], "Sector prior: allowed ROE typically 14-16% (CERC/SERC)", "low", "utility-allowed-roe-prior"),
  };
}

function deriveCostOfEquity(config: EngineConfig): { value: number; prov: DerivationProvenance } {
  const ke = ke_from_config(config);
  return {
    value: clamp(ke, 0.05, 0.25),
    prov: prov(["config.ke", "config.risk_free_rate", "config.beta", "config.company_type"], "Cost of equity from config (sector-adjusted CAPM)", "medium", "sector-ke-prior"),
  };
}

function deriveTerminalGrowth(config: EngineConfig): { value: number; prov: DerivationProvenance } {
  const g = config.terminal_growth_rate ?? config.g_terminal_override ?? 0.04;
  return {
    value: clamp(g, -0.02, 0.06),
    prov: prov(["config.terminal_growth_rate", "config.g_terminal_override"], "Terminal growth from config (default 4%)", "medium", "terminal-growth-prior"),
  };
}

function deriveNetDebtCr(periods: readonly RecastPeriod[]): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const nfo = bs(latest, "NFO");
  if (nfo != null) {
    return {
      value: nfo,
      prov: prov(["bs.NFO"], "Net financial obligations (NFO) from recast balance sheet", "high"),
    };
  }
  const fo = bs(latest, "FO");
  const fa = bs(latest, "FA");
  if (fo != null && fa != null) {
    return {
      value: fo - fa,
      prov: prov(["bs.FO", "bs.FA"], "Net debt = FO - FA (NFO unavailable)", "medium"),
    };
  }
  return {
    value: 0,
    prov: prov(["bs.NFO", "bs.FO", "bs.FA"], "No debt fields available; assuming zero net debt", "low"),
  };
}

export function deriveUtilityCaseInput(
  periods: readonly RecastPeriod[],
  config: EngineConfig,
  issuerId: string,
  asOf: string,
  sharesOutstandingCr: number | null,
): UtilityDerivationResult {
  const latest = latestPeriod(periods);
  if (!latest) {
    return {
      input: null,
      provenance: {},
      missingEvidence: ["utility.rate-base", "utility.tariff-return", "utility.capital-structure"],
      reason: "No recast periods available.",
    };
  }

  const provenance: Record<string, DerivationProvenance> = {};
  const missing: string[] = [];

  // Shares outstanding
  if (sharesOutstandingCr == null || sharesOutstandingCr <= 0) {
    missing.push("common.share-basis");
    return {
      input: null,
      provenance: {},
      missingEvidence: missing,
      reason: "Share basis unavailable; cannot produce per-share output.",
    };
  }

  // Rate base
  const rateBase = deriveRegulatedRateBaseCr(periods);
  provenance["regulatedRateBaseCr"] = rateBase.prov;
  if (rateBase.value == null) missing.push("utility.rate-base");

  // CWIP
  const cwip = deriveConstructionWorkInProgressCr(periods);
  provenance["constructionWorkInProgressCr"] = cwip.prov;

  // CWIP eligibility
  const cwipEligibility = deriveCwipEligibilityPct();
  provenance["cwipEligibilityPct"] = cwipEligibility.prov;

  // Regulatory assets
  const regulatoryAssets = deriveRegulatoryAssetsCr(periods);
  provenance["regulatoryAssetsCr"] = regulatoryAssets.prov;

  // Regulatory liabilities
  const regulatoryLiabilities = deriveRegulatoryLiabilitiesCr();
  provenance["regulatoryLiabilitiesCr"] = regulatoryLiabilities.prov;

  // Equity weight
  const equityWeight = deriveRegulatedEquityWeight(periods, config);
  provenance["regulatedEquityWeight"] = equityWeight.prov;

  // Allowed ROE
  const allowedRoe = deriveAllowedReturnOnEquity();
  provenance["allowedReturnOnEquity"] = allowedRoe.prov;

  // Cost of equity
  const costOfEquity = deriveCostOfEquity(config);
  provenance["costOfEquity"] = costOfEquity.prov;

  // Terminal growth
  const terminalGrowth = deriveTerminalGrowth(config);
  provenance["terminalGrowth"] = terminalGrowth.prov;

  // Net debt
  const netDebt = deriveNetDebtCr(periods);
  provenance["netDebtCr"] = netDebt.prov;

  // Evidence map: satisfy registry requirements when derivation succeeded
  const evidence: Record<string, readonly string[]> = {};
  if (!missing.includes("utility.rate-base")) {
    evidence["utility.rate-base"] = ["seade:derived:rate-base"];
  }
  if (!missing.includes("utility.tariff-return")) {
    evidence["utility.tariff-return"] = ["seade:derived:tariff-return"];
  }
  if (!missing.includes("utility.capital-structure")) {
    evidence["utility.capital-structure"] = ["seade:derived:capital-structure"];
  }

  if (missing.length > 0) {
    return {
      input: null,
      provenance,
      missingEvidence: missing,
      reason: `Insufficient evidence for ${missing.length} required input(s): ${missing.join(", ")}.`,
    };
  }

  const input: UtilityRabCaseInput = {
    caseType: "utility-rab",
    issuerId,
    asOf,
    companyType: "utility",
    sharesOutstandingCr,
    evidence,
    regulatedRateBaseCr: rateBase.value!,
    constructionWorkInProgressCr: cwip.value,
    cwipEligibilityPct: cwipEligibility.value,
    regulatoryAssetsCr: regulatoryAssets.value,
    regulatoryLiabilitiesCr: regulatoryLiabilities.value,
    regulatedEquityWeight: equityWeight.value,
    allowedReturnOnEquity: allowedRoe.value,
    costOfEquity: costOfEquity.value,
    terminalGrowth: terminalGrowth.value,
    netDebtCr: netDebt.value,
  };

  return {
    input,
    provenance,
    missingEvidence: [],
    reason: "",
  };
}
