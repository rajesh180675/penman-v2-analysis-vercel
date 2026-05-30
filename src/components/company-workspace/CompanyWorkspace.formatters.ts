import { AnalysisStatusSummary } from "../../engine/analysisStatus";
import { CompanyRegistry, RawPeriodData } from "../../engine/types";
import { listWorkspaceCompanies } from "../../lib/researchWorkspace";

export interface InspectorRunPayload {
  runId: string;
  latestAt: string | null;
  latestAnalysisSnapshot?: {
    latestPeriod?: string | null | undefined;
  } | null;
  latestValuationSignal?: {
    label?: string | null | undefined;
    state?: string | null | undefined;
    summary?: string | null | undefined;
    baseUpsidePct?: number | null | undefined;
    stressUpsidePct?: number | null | undefined;
    opportunityScore?: number | null | undefined;
    convictionBucket?: string | null | undefined;
    expectedCagrStress?: number | null | undefined;
  } | null;
  latestValuationManifest?: {
    sectorTemplate?: { label?: string | null } | null;
    opportunity?: {
      thesis?: string | null | undefined;
      requiredMarginOfSafetyPct?: number | null | undefined;
      qualityScore?: number | null | undefined;
      opportunityScore?: number | null | undefined;
      convictionBucket?: string | null | undefined;
      expectedCagrStress?: number | null | undefined;
    } | null;
    marketContext?: {
      expectedReturnSpreadVsRf?: number | null | undefined;
      priceToStressValueRatio?: number | null | undefined;
    } | null;
    checklist?: {
      whatMustGoRight?: string[] | undefined;
      thesisBreakers?: string[] | undefined;
    } | null;
    backtest?: {
      available?: boolean | undefined;
      forwardWinRate1Y?: number | null | undefined;
      forwardWinRate3Y?: number | null | undefined;
      median3Y?: number | null | undefined;
      latestComparedToHistory?: string | null | undefined;
    } | null;
  } | null;
  health?: {
    severity?: "ok" | "warning" | "critical" | undefined;
    findings?: string[] | undefined;
  } | null;
}

export function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function toneForState(state: string | null | undefined) {
  if (state === "blocked") return "border-red-200 bg-red-50 text-red-800";
  if (state === "guarded") return "border-amber-200 bg-amber-50 text-amber-800";
  if (state === "high-conviction" || state === "screaming-buy") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "interesting") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

export function investorGuidance(args: {
  status?: AnalysisStatusSummary["status"] | "unknown" | undefined;
  signalState?: string | null | undefined;
  convictionBucket?: string | null | undefined;
}) {
  const { status, signalState, convictionBucket } = args;
  if (status === "blocked" || signalState === "blocked") {
    return {
      title: "Do not treat this as investable output",
      detail: "The accounting or scope checks are blocking the valuation. Use this company only to diagnose data quality or unsupported business-model issues.",
    };
  }
  if (status === "guarded" || signalState === "guarded") {
    return {
      title: "Use this as research input, not a sizing anchor",
      detail: "The model is directionally useful, but the confidence is not strong enough to convert the output into a final investment decision.",
    };
  }
  if (signalState === "screaming-buy" || convictionBucket === "truck-load zone") {
    return {
      title: "Rare dislocation protocol",
      detail: "This is the only zone where aggressive buying is discussable. Re-check liquidity, balance-sheet safety, and thesis breakers before increasing size.",
    };
  }
  if (signalState === "high-conviction" || convictionBucket === "high-conviction") {
    return {
      title: "Strong setup, still thesis-dependent",
      detail: "The next step is not another valuation rerun. Validate catalysts, durability of economics, and downside conditions before committing more capital.",
    };
  }
  if (signalState === "interesting" || convictionBucket === "accumulate") {
    return {
      title: "Interesting, not yet rare",
      detail: "Track it, sharpen the thesis, and wait either for stronger evidence or a better price rather than forcing a decision.",
    };
  }
  return {
    title: "Build understanding before building exposure",
    detail: "Start with business summary, key drivers, accounting confidence, and the stress case. If those do not line up, valuation should not drive the decision.",
  };
}

export function toTextAreaValue(value: string) {
  return value ?? "";
}

export function buildCompanyOptions(params: {
  registry: CompanyRegistry;
  rawData: RawPeriodData[] | null;
}) {
  const options = new Map<string, { companyId: string; label: string }>();
  for (const record of listWorkspaceCompanies()) {
    options.set(record.companyId, { companyId: record.companyId, label: record.label || record.companyId });
  }
  for (const item of Object.values(params.registry.companies)) {
    options.set(item.id, { companyId: item.id, label: item.label || item.id });
  }
  const currentCompanyId = params.rawData?.[0]?.company_id;
  if (currentCompanyId) {
    options.set(currentCompanyId, { companyId: currentCompanyId, label: currentCompanyId });
  }
  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
}
