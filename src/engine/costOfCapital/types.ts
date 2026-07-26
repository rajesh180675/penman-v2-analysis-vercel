import type { EngineConfig, RecastPeriod } from "../types";
import type { AssumptionTier, CapitalCostAssumptionSet } from "../assumptions/capitalCostAssumptions";

export const COST_OF_CAPITAL_POLICY_VERSION = "2026-07-cost-of-capital-v1" as const;

export interface CostEvidence {
  readonly component: "risk-free" | "beta" | "erp" | "debt-cost" | "tax" | "capital-structure";
  readonly source: string;
  readonly asOf: string | null;
  readonly value: number;
  readonly evidenceRefs: readonly string[];
  /**
   * Provenance strength of the value. Present for the CAPM inputs, which are the
   * ones that were previously indistinguishable from sourced data; absent for
   * components not yet tiered (debt cost, tax, capital structure).
   */
  readonly tier?: AssumptionTier | undefined;
  /** Why a weaker tier was used. Present only when `tier` is `prior`. */
  readonly fallbackReason?: string | undefined;
}

export type CostOfEquityPolicy =
  | {
      readonly mode: "capm";
      readonly riskFreeRate: number;
      readonly beta: number;
      readonly equityRiskPremium: number;
      readonly riskFreeSource: string;
      readonly betaSource: string;
      readonly erpSource: string;
      readonly asOf: string | null;
      readonly evidenceRefs: readonly string[];
      /**
       * Provenance tiers for the three CAPM inputs above, when the policy was
       * built from `costPoliciesFromConfig`. Optional so a caller can still
       * hand-build a policy; when absent, evidence rows carry no tier and the
       * assumption-provenance gate has nothing to judge.
       */
      readonly assumptions?: CapitalCostAssumptionSet | undefined;
    }
  | {
      readonly mode: "manual";
      readonly ke: number;
      readonly rationale: string;
      readonly evidenceRefs: readonly string[];
    };

export type CostOfDebtPolicy =
  | {
      readonly mode: "reported-effective";
      readonly fallbackSpread: number;
    }
  | {
      readonly mode: "credit-spread";
      readonly riskFreeRate: number;
      readonly spread: number;
      readonly curveSource: string;
      readonly ratingSource: string;
      readonly asOf: string | null;
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly mode: "manual";
      readonly kdPretax: number;
      readonly rationale: string;
      readonly evidenceRefs: readonly string[];
    };

export interface CapitalStructureWeights {
  readonly period: string | null;
  readonly equityClaims: number | null;
  readonly netFinancialObligations: number | null;
  readonly operatingAssetBase: number | null;
  readonly equityWeight: number;
  readonly debtWeight: number;
  readonly source: "structural" | "config-fallback";
}

export interface CostOfCapitalGuard {
  readonly guardId: string;
  readonly status: "passed" | "warned" | "failed";
  readonly observed: number | null;
  readonly summary: string;
}

export interface CostOfCapitalResult {
  readonly policyVersion: typeof COST_OF_CAPITAL_POLICY_VERSION;
  readonly status: "confirmed" | "guarded" | "blocked";
  readonly ke: number;
  readonly kdPretax: number;
  readonly kdAfterTax: number;
  readonly kw: number;
  readonly equityMode: CostOfEquityPolicy["mode"];
  readonly debtMode: CostOfDebtPolicy["mode"];
  readonly beta: number | null;
  readonly riskFreeRate: number;
  readonly equityRiskPremium: number | null;
  /**
   * Provenance tiers for the capital-cost inputs, when the policy was built from
   * `costPoliciesFromConfig`. Absent for manual ke and for hand-built policies —
   * absent means "no tiers were reported", which is NOT the same as "sourced".
   */
  readonly assumptions?: CapitalCostAssumptionSet | undefined;
  readonly taxRate: number;
  readonly weights: CapitalStructureWeights;
  readonly evidence: readonly CostEvidence[];
  readonly warnings: readonly string[];
  readonly guards: readonly CostOfCapitalGuard[];
}

export interface ResolveCostOfCapitalInput {
  readonly equityPolicy: CostOfEquityPolicy;
  readonly debtPolicy: CostOfDebtPolicy;
  readonly config: EngineConfig;
  readonly current?: RecastPeriod | null | undefined;
  readonly previous?: RecastPeriod | null | undefined;
}
