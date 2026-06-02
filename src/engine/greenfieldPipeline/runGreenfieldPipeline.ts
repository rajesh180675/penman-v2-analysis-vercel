import { applyAdjustments } from "./adjusters";
import { scoreGreenfieldConfidence } from "./confidence";
import { runAllDetectors } from "./detectors";
import { normalizePeriods } from "./l1Normalize";
import { triageSignals } from "./triage";
import { validateAdjustments } from "./validateAdjustments";
import type { GreenfieldPipelineInput, GreenfieldPipelineResult } from "./types";

export function runGreenfieldPipeline(input: GreenfieldPipelineInput): GreenfieldPipelineResult {
  const asReported = normalizePeriods(input.rawData, input.config, input.recastData ?? []);
  const signals = runAllDetectors(asReported, input.context ?? {});
  const triage = triageSignals(signals, input.config);
  const adjustedResult = applyAdjustments(asReported, triage);
  const validated = validateAdjustments(asReported, adjustedResult.adjusted, adjustedResult.auditTrail);
  const confidence = scoreGreenfieldConfidence({
    asReported,
    adjusted: adjustedResult.adjusted,
    triage,
    validation: validated.validation,
    asOf: input.context?.asOf,
  });
  return {
    asReported,
    adjusted: adjustedResult.adjusted,
    signals,
    triage,
    auditTrail: validated.auditTrail,
    validation: validated.validation,
    confidence,
    analysisWindow: adjustedResult.analysisWindow,
  };
}
