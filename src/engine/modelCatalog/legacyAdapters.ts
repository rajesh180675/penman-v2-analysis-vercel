import type { ContinuingValueGuard, ValuationResult } from "../types";
import type { ValuationCommandCenterOutput, ValuationScenarioCard } from "../valuationCommandCenter";
import { CURRENT_MODEL_REGISTRY } from "./definitions";
import type { ModelGuardResult, ValuationModelResult } from "./types";

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function version(modelId: string): string {
  return CURRENT_MODEL_REGISTRY.get(modelId)?.modelVersion ?? "unregistered";
}

function missing(modelId: string, caseId: string | null, reasonCode: string): ValuationModelResult {
  return {
    modelId,
    modelVersion: version(modelId),
    caseId,
    status: "insufficient-evidence",
    reasonCode,
    missingRequirementIds: CURRENT_MODEL_REGISTRY.get(modelId)?.requirements
      .filter((requirement) => requirement.purpose === "compute")
      .map((requirement) => requirement.requirementId) ?? [],
  };
}

function guardResult(guard: ContinuingValueGuard): ModelGuardResult {
  return {
    guardId: "terminal.discount-growth-spread",
    guardVersion: "1.0.0",
    status: "failed",
    blocksResult: true,
    observed: guard.spread,
    threshold: "> 0",
    evidenceRefs: [],
    summary: guard.reason,
  };
}

function computedOrMissing(args: {
  modelId: string;
  caseId: string | null;
  enterpriseValue?: number | null | undefined;
  equityValue?: number | null | undefined;
  perShare?: number | null | undefined;
  diagnostics?: Readonly<Record<string, number | string | boolean | null>> | undefined;
  failedGuards?: readonly ModelGuardResult[] | undefined;
  missingReason?: string | undefined;
}): ValuationModelResult {
  const enterpriseValue = finite(args.enterpriseValue);
  const equityValue = finite(args.equityValue);
  const perShare = finite(args.perShare);
  if (args.failedGuards?.length) {
    return {
      modelId: args.modelId,
      modelVersion: version(args.modelId),
      caseId: args.caseId,
      status: "invalid",
      reasonCode: "MODEL_GUARD_FAILED",
      failedGuards: args.failedGuards,
    };
  }
  if (enterpriseValue == null && equityValue == null && perShare == null) {
    return missing(args.modelId, args.caseId, args.missingReason ?? "NO_FINITE_LEGACY_OUTPUT");
  }
  return {
    modelId: args.modelId,
    modelVersion: version(args.modelId),
    caseId: args.caseId,
    status: "computed",
    enterpriseValue,
    equityValue,
    perShare,
    unit: perShare != null ? "INR_PER_SHARE" : "INR_CRORE",
    evidenceRefs: [],
    transformationRefs: [],
    diagnostics: args.diagnostics ?? {},
    guardResults: [],
  };
}

function terminalGuards(
  valuation: ValuationResult,
  models: readonly ContinuingValueGuard["model"][],
): ModelGuardResult[] {
  return (valuation.continuingValueGuards ?? [])
    .filter((guard) => models.includes(guard.model))
    .map(guardResult);
}

function scenarioResults(card: ValuationScenarioCard): ValuationModelResult[] {
  const valuation = card.valuation;
  const perShare = valuation.perShare;
  return [
    computedOrMissing({
      modelId: "industrial.penman.residual-income",
      caseId: card.key,
      equityValue: valuation.V_RE_CV3,
      perShare: perShare?.intrinsic_re_per_share,
      failedGuards: terminalGuards(valuation, ["RE_CV3"]),
    }),
    computedOrMissing({
      modelId: "industrial.penman.residual-operating-income",
      caseId: card.key,
      enterpriseValue: valuation.EV_ReOI,
      equityValue: valuation.V_ReOI_CV03,
      perShare: perShare?.intrinsic_reoi_per_share,
      failedGuards: terminalGuards(valuation, ["ReOI_CV03"]),
    }),
    computedOrMissing({
      modelId: "industrial.penman.fcff-cross-check",
      caseId: card.key,
      enterpriseValue: valuation.fcf?.EV_FCFF,
      perShare: perShare?.intrinsic_fcff_per_share,
      failedGuards: terminalGuards(valuation, ["FCFF_CV"]),
    }),
    computedOrMissing({
      modelId: "industrial.penman.fcfe-cross-check",
      caseId: card.key,
      equityValue: valuation.fcf?.V_FCFE,
      perShare: perShare?.intrinsic_fcfe_per_share,
      failedGuards: terminalGuards(valuation, ["FCFE_CV"]),
    }),
    computedOrMissing({
      modelId: "industrial.penman.aeg-cross-check",
      caseId: card.key,
      equityValue: valuation.aeg?.V_AEG,
      perShare: perShare?.intrinsic_aeg_per_share,
    }),
    computedOrMissing({
      modelId: "industrial.penman.ddm-cross-check",
      caseId: card.key,
      perShare: perShare?.intrinsic_ddm_per_share,
      failedGuards: terminalGuards(valuation, ["DDM"]),
    }),
    computedOrMissing({
      modelId: "industrial.owner-earnings-dcf",
      caseId: card.key,
      perShare: card.ownerEarningsDcfPerShare,
    }),
    computedOrMissing({
      modelId: "industrial.scenario-headline",
      caseId: card.key,
      perShare: card.intrinsicPerShare,
    }),
  ];
}

/**
 * Transitional adapter that turns the broad legacy command-center object into
 * explicit model-result states. Catalog metadata remains authoritative for
 * category, lifecycle, and independence; this adapter never infers a model
 * from a routing strategy identifier.
 */
export function adaptLegacyCommandCenterModelResults(
  output: ValuationCommandCenterOutput,
): readonly ValuationModelResult[] {
  const shares = output.shareBasis.sharesForPerShare ?? output.shareBasis.shares ?? null;
  const results = output.scenarios.flatMap(scenarioResults);
  results.push(
    computedOrMissing({
      modelId: "industrial.cash-statement-fcff-dcf",
      caseId: "base",
      enterpriseValue: output.cashFlowDcf?.enterpriseValue,
      equityValue: output.cashFlowDcf?.equityValue,
      perShare: output.cashFlowDcf?.perShare,
      missingReason: "CASH_DCF_NOT_COMPUTED",
    }),
    computedOrMissing({
      modelId: "industrial.graham-dodd-epv",
      caseId: "base",
      enterpriseValue: output.epv?.epvOperations,
      equityValue: output.epv?.epvEquity,
      perShare: output.epv?.epvPerShare,
      missingReason: "EPV_NOT_COMPUTED",
    }),
    computedOrMissing({
      modelId: "industrial.segment-sotp",
      caseId: "base",
      enterpriseValue: output.sotp?.totalEnterpriseValue,
      missingReason: "SOTP_NOT_COMPUTED",
    }),
    computedOrMissing({
      modelId: "industrial.ev-ebitda-peer",
      caseId: "base",
      enterpriseValue: output.evEbitda.evFromMedian,
      equityValue: output.evEbitda.equityFromMedian,
      perShare: shares && shares > 0 && output.evEbitda.equityFromMedian != null
        ? output.evEbitda.equityFromMedian / shares
        : null,
      missingReason: "PEER_MULTIPLE_NOT_COMPUTED",
    }),
    computedOrMissing({
      modelId: "industrial.reverse-dcf",
      caseId: null,
      diagnostics: {
        impliedOwnerEarningsGrowth: finite(output.reverseDcf.impliedOwnerEarningsGrowth),
        impliedTerminalROIC: finite(output.reverseDcf.impliedTerminalROIC),
        impliedKE: finite(output.reverseDcf.impliedKE),
      },
      missingReason: "MARKET_IMPLIED_DIAGNOSTIC_HAS_NO_INTRINSIC_VALUE",
    }),
    computedOrMissing({
      modelId: "industrial.evidence-weighted-synthesis",
      caseId: null,
      perShare: output.evidenceWeightedSynthesis.intrinsicRange.midPerShare,
      diagnostics: {
        lowPerShare: finite(output.evidenceWeightedSynthesis.intrinsicRange.lowPerShare),
        highPerShare: finite(output.evidenceWeightedSynthesis.intrinsicRange.highPerShare),
      },
      missingReason: "SYNTHESIS_NOT_COMPUTED",
    }),
  );
  return results;
}
