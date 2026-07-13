import { esgAdjustedKe, type EsgAdjustedKeInputs } from "../valuation/esgAdjustedKe";
import { fxNeutralRevenue, type FxRevenuePeriod } from "../valuation/fxHedging";
import { capitalizeOperatingLeases, validateLeaseSelfConsistency, type CapitalizeOperatingLeasesInputs, type LeaseSelfConsistencyInputs } from "../valuation/leaseAdjustments";
import { valueRDPipeline, type RDPipelineInputs, type RDPipelineResult } from "../valuation/realOptionsBlackScholes";
import type { ModelPromotionDecision } from "./promotion";

interface GovernedInputBase {
  readonly issuerId: string;
  readonly asOf: string;
  readonly sidecarId: string;
  readonly sidecarStatus: "approved" | "draft" | "rejected";
  readonly evidenceRefs: readonly string[];
  readonly transformationRefs: readonly string[];
}

export type GovernedAdvancedModelInput =
  | (GovernedInputBase & {
      readonly modelId: "advanced.real-options-rd-pipeline";
      readonly input: RDPipelineInputs;
      /** Required before a promoted monetary result can be composed into valuation. */
      readonly outputBridge?: {
        readonly sourceMonetaryUnit: "INR" | "INR_CRORE";
        readonly sharesOutstandingCr: number;
        readonly valueRole: "incremental-equity-adjustment";
      };
    })
  | (GovernedInputBase & { readonly modelId: "advanced.esg-adjusted-ke"; readonly input: EsgAdjustedKeInputs })
  | (GovernedInputBase & { readonly modelId: "advanced.fx-neutral-revenue"; readonly input: { readonly periods: readonly FxRevenuePeriod[] } })
  | (GovernedInputBase & { readonly modelId: "advanced.lease-capitalization"; readonly input: { readonly capitalization: CapitalizeOperatingLeasesInputs; readonly consistency: LeaseSelfConsistencyInputs } });

export type GovernedAdvancedModelResult =
  | {
      readonly status: "computed";
      readonly modelId: GovernedAdvancedModelInput["modelId"];
      readonly issuerId: string;
      readonly asOf: string;
      readonly output: unknown;
      readonly evidenceRefs: readonly string[];
      readonly transformationRefs: readonly string[];
      readonly eligibleForProductionUse: boolean;
      readonly eligibleForIntrinsicComposition: boolean;
      readonly eligibleForIntrinsicSynthesis: boolean;
      readonly valuationBridge: {
        readonly role: "incremental-equity-adjustment";
        readonly sourceMetric: "totalExpectedValue";
        readonly sourceMonetaryUnit: "INR" | "INR_CRORE";
        readonly equityAdjustmentCr: number;
        readonly perShareAdjustment: number;
        readonly sharesOutstandingCr: number;
      } | null;
    }
  | {
      readonly status: "blocked";
      readonly modelId: GovernedAdvancedModelInput["modelId"];
      readonly reasonCodes: readonly string[];
    };

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeRealOptionsOutput(request: Extract<GovernedAdvancedModelInput, { modelId: "advanced.real-options-rd-pipeline" }>, output: RDPipelineResult) {
  const bridge = request.outputBridge;
  if (!bridge) return null;
  const equityAdjustmentCr = bridge.sourceMonetaryUnit === "INR" ? output.totalExpectedValue / 10_000_000 : output.totalExpectedValue;
  return Object.freeze({
    role: bridge.valueRole,
    sourceMetric: "totalExpectedValue" as const,
    sourceMonetaryUnit: bridge.sourceMonetaryUnit,
    equityAdjustmentCr,
    perShareAdjustment: equityAdjustmentCr / bridge.sharesOutstandingCr,
    sharesOutstandingCr: bridge.sharesOutstandingCr,
  });
}

function allFinite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFinite);
  if (value && typeof value === "object") return Object.values(value).every(allFinite);
  return true;
}

function inputReasonCodes(request: GovernedAdvancedModelInput): string[] {
  const reasons: string[] = [];
  if (!validDateOnly(request.asOf)) reasons.push("AS_OF_INVALID");
  if (!request.issuerId.trim() || !request.sidecarId.trim()) reasons.push("IDENTITY_REQUIRED");
  switch (request.modelId) {
    case "advanced.real-options-rd-pipeline":
      if (!request.input.projects.length || !(request.input.riskFreeRate >= 0 && request.input.riskFreeRate < 1)) reasons.push("OPTION_INPUT_INVALID");
      if (request.input.projects.some((project) => !project.id.trim() || !project.stage.trim() || !(project.underlyingValue >= 0) || !(project.developmentCost >= 0) || !(project.timeToDecisionYears > 0) || !(project.probabilityOfSuccess >= 0 && project.probabilityOfSuccess <= 1) || !(project.volatility >= 0 && project.volatility < 5))) reasons.push("OPTION_PROJECT_INVALID");
      if (request.outputBridge && (
        !(request.outputBridge.sharesOutstandingCr > 0)
        || !Number.isFinite(request.outputBridge.sharesOutstandingCr)
        || !["INR", "INR_CRORE"].includes(request.outputBridge.sourceMonetaryUnit)
        || request.outputBridge.valueRole !== "incremental-equity-adjustment"
      )) reasons.push("OUTPUT_BRIDGE_INVALID");
      break;
    case "advanced.esg-adjusted-ke":
      if (!(request.input.baseKe > 0 && request.input.baseKe < 1)
        || ((request.input.msciScore == null) === (request.input.bucket == null))
        || (request.input.msciScore != null && !(request.input.msciScore >= 0 && request.input.msciScore <= 10))
        || (request.input.customBpsOverride != null && !(Number.isFinite(request.input.customBpsOverride) && request.input.customBpsOverride >= -500 && request.input.customBpsOverride <= 500))) reasons.push("ESG_INPUT_INVALID");
      break;
    case "advanced.fx-neutral-revenue":
      if (request.input.periods.length < 2 || request.input.periods.some((period) => !validDateOnly(period.periodEnd) || period.periodEnd > request.asOf || !(period.reportedRevenueCr >= 0) || !(period.averageRateInrPerForeign > 0) || !(period.closingRateInrPerForeign > 0) || !(period.foreignCurrencyMix >= 0 && period.foreignCurrencyMix <= 1))) reasons.push("FX_INPUT_INVALID");
      if (new Set(request.input.periods.map((period) => period.periodEnd)).size !== request.input.periods.length || request.input.periods.some((period, index) => index > 0 && period.periodEnd <= request.input.periods[index - 1]!.periodEnd)) reasons.push("FX_PERIOD_ORDER_INVALID");
      break;
    case "advanced.lease-capitalization": {
      const cap = request.input.capitalization;
      const consistency = request.input.consistency;
      if (!(cap.annualRent >= 0) || (cap.multiple != null && !(cap.multiple > 0)) || (cap.taxRate != null && !(cap.taxRate >= 0 && cap.taxRate <= 1))) reasons.push("LEASE_CAPITALIZATION_INPUT_INVALID");
      if (![consistency.rouAsset, consistency.leaseLiability, consistency.depreciationOnRou, consistency.leaseInterest, consistency.totalRentPayments].every((value) => Number.isFinite(value) && value >= 0)) reasons.push("LEASE_CONSISTENCY_INPUT_INVALID");
      break;
    }
  }
  return reasons;
}

export function executeGovernedAdvancedModel(
  request: GovernedAdvancedModelInput,
  promotion: ModelPromotionDecision,
): GovernedAdvancedModelResult {
  const reasons: string[] = [];
  if (request.sidecarStatus !== "approved") reasons.push("SIDECAR_NOT_APPROVED");
  if (!request.evidenceRefs.length || request.evidenceRefs.some((ref) => !ref.trim())) reasons.push("EVIDENCE_REQUIRED");
  if (!request.transformationRefs.length || request.transformationRefs.some((ref) => !ref.trim())) reasons.push("TRANSFORMATION_LINEAGE_REQUIRED");
  if (promotion.modelId !== request.modelId) reasons.push("PROMOTION_MODEL_MISMATCH");
  reasons.push(...inputReasonCodes(request));
  if (reasons.length) return { status: "blocked", modelId: request.modelId, reasonCodes: reasons };

  let output: unknown;
  try {
    switch (request.modelId) {
      case "advanced.real-options-rd-pipeline": output = valueRDPipeline(request.input); break;
      case "advanced.esg-adjusted-ke": output = esgAdjustedKe(request.input); break;
      case "advanced.fx-neutral-revenue": output = fxNeutralRevenue(request.input.periods); break;
      case "advanced.lease-capitalization": output = {
        capitalization: capitalizeOperatingLeases(request.input.capitalization),
        consistency: validateLeaseSelfConsistency(request.input.consistency),
      }; break;
    }
  } catch {
    return { status: "blocked", modelId: request.modelId, reasonCodes: ["MODEL_EXECUTION_FAILED"] };
  }
  if (!allFinite(output)) return { status: "blocked", modelId: request.modelId, reasonCodes: ["MODEL_OUTPUT_NON_FINITE"] };
  if (request.modelId === "advanced.esg-adjusted-ke" && !((output as { adjustedKe?: number }).adjustedKe! > 0 && (output as { adjustedKe?: number }).adjustedKe! < 1)) {
    return { status: "blocked", modelId: request.modelId, reasonCodes: ["MODEL_OUTPUT_OUT_OF_DOMAIN"] };
  }
  const eligibleForProductionUse = promotion.status === "eligible"
    || (promotion.fromLifecycle === "production" && promotion.blockerCodes.length === 0);
  if (eligibleForProductionUse && request.modelId === "advanced.real-options-rd-pipeline" && !request.outputBridge) {
    return { status: "blocked", modelId: request.modelId, reasonCodes: ["OUTPUT_BRIDGE_REQUIRED"] };
  }
  const valuationBridge = request.modelId === "advanced.real-options-rd-pipeline"
    ? normalizeRealOptionsOutput(request, output as RDPipelineResult)
    : null;
  if (valuationBridge && !allFinite(valuationBridge)) return { status: "blocked", modelId: request.modelId, reasonCodes: ["OUTPUT_BRIDGE_NON_FINITE"] };
  return {
    status: "computed",
    modelId: request.modelId,
    issuerId: request.issuerId,
    asOf: request.asOf,
    output,
    evidenceRefs: request.evidenceRefs,
    transformationRefs: request.transformationRefs,
    eligibleForProductionUse,
    eligibleForIntrinsicComposition: eligibleForProductionUse && valuationBridge !== null,
    // An incremental option adjustment is not a standalone fair-value model.
    // A separate composition policy must bind it to a base valuation and prove
    // that the same optionality is not already embedded there.
    eligibleForIntrinsicSynthesis: false,
    valuationBridge,
  };
}
