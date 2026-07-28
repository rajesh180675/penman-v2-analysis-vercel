/* ================================================================
   assumptionProvenance enricher (schema v21).

   Pure function: reads the tiered capital-cost assumptions the resolver already
   produced and rolls them into the AssumptionProvenanceSummary block surfaced in
   the shared trust envelope.

   It computes nothing new. It READS the four inputs that set every discount rate
   and terminal value in the system — risk-free rate, ERP, beta, terminal-growth
   ceiling — and reports, per input, whether the number was:
     - estimated : computed from data we hold (bottom-up beta from peer betas)
     - sourced   : a dated third-party value with an attributable origin
     - prior     : a sector/config default. Still used; now named.

   Lives outside buildAnalysisTraceability for the same reason analyticalDepth
   does: capital cost is valuation-time output, and the structural builder runs
   where valuation is out of scope.
================================================================ */

import type { AssumptionTier, CapitalCostAssumptionSet, TieredAssumption } from "./assumptions/capitalCostAssumptions";
import type {
  AssumptionProvenanceCheck,
  AssumptionProvenanceStatus,
  AssumptionProvenanceSummary,
  AssumptionProvenanceTier,
} from "./types/assumptionProvenance";

/**
 * The envelope type restates the tier union to stay a pure leaf. This assignment
 * makes any drift between the two a compile error rather than a silent mismatch.
 */
const _tierUnionsAgree: AssumptionProvenanceTier extends AssumptionTier
  ? AssumptionTier extends AssumptionProvenanceTier ? true : never
  : never = true;
void _tierUnionsAgree;

const LABELS: Record<string, string> = {
  "risk-free-rate": "Risk-free rate",
  "equity-risk-premium": "Equity risk premium",
  "beta": "Beta",
  "terminal-growth-ceiling": "Terminal growth ceiling",
};

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function toCheck(assumption: TieredAssumption): AssumptionProvenanceCheck {
  const label = LABELS[assumption.key] ?? assumption.key;
  const shown = assumption.key === "beta" ? assumption.value.toFixed(3) : pct(assumption.value);
  return {
    key: assumption.key,
    label,
    tier: assumption.tier,
    value: Number.isFinite(assumption.value) ? assumption.value : null,
    source: assumption.source,
    asOf: assumption.asOf,
    detail: assumption.tier === "prior"
      // Name the guess and why it was reached. A reviewer needs the reason, not
      // just the label, to decide whether the run is usable for their purpose.
      ? `${label} ${shown} rests on an undated prior (${assumption.source}). ${assumption.fallbackReason ?? ""}`.trim()
      : `${label} ${shown} — ${assumption.tier} via ${assumption.source}${assumption.asOf ? ` as of ${assumption.asOf}` : ""}. ${assumption.method}`,
  };
}

/**
 * Build the assumptionProvenance block from a resolved capital-cost result.
 *
 * @param assumptions the tier set from `resolveCapitalCostAssumptions`, as
 *   carried on `CostOfCapitalResult.assumptions`. Pass null/undefined when the
 *   run reported no tiers (manual ke, hand-built policy, or no valuation) — the
 *   result is `absent`, which is deliberately distinct from `defensible`.
 * @param options pass `equityMode` from `CostOfCapitalResult.equityMode` so a
 *   manual ke is distinguishable from the other reasons tiers can be missing.
 *   Omit it and the old behaviour is unchanged.
 */
export function buildAssumptionProvenance(
  assumptions: CapitalCostAssumptionSet | null | undefined,
  options?: {
    readonly equityMode?: "capm" | "manual" | undefined;
    /** The resolved ke, only used to name the rate in the check's detail. */
    readonly ke?: number | undefined;
  },
): AssumptionProvenanceSummary {
  if (!assumptions) {
    // A manual ke reports no tiers, which used to land here as `absent` — and
    // `absent` does not fire the provenance gate. So the least attributable
    // input in the system cleared a gate that a sector-prior beta blocks: a
    // reviewer could type a discount rate and reach production-ready, while the
    // same run with a measured-but-imprecise beta could not.
    //
    // The reviewer's number is still used. It is now reported for what it is: a
    // rate with no observation date and no third-party attribution, which is the
    // definition of a prior in this module. `absent` stays reserved for the case
    // it was written for — no valuation ran, or the policy was hand-built — where
    // silence really is the absence of a claim rather than an unsourced one.
    if (options?.equityMode === "manual") {
      const shown = options.ke != null && Number.isFinite(options.ke) ? pct(options.ke) : "—";
      const detail = `Cost of equity ${shown} rests on an undated prior (reviewer-supplied manual rate). Manual mode bypasses CAPM entirely, so no risk-free rate, beta or equity risk premium was resolved and none can be attributed.`;
      return {
        status: "prior-dependent",
        summary: `The cost of equity was supplied directly by a reviewer (${shown}); it carries no observation date or third-party attribution, so the discount rate is a judgment, not an observation.`,
        defensibleCount: 0,
        priorCount: 1,
        priorTierKeys: ["cost-of-equity"],
        checks: [{
          key: "cost-of-equity",
          label: "Cost of equity (manual)",
          tier: "prior",
          value: options.ke != null && Number.isFinite(options.ke) ? options.ke : null,
          source: "Reviewer-supplied manual cost of equity",
          asOf: null,
          detail,
        }],
      };
    }
    return {
      status: "absent",
      summary: "No tiered capital-cost assumptions were reported for this run, so assumption provenance cannot be assessed.",
      defensibleCount: 0,
      priorCount: 0,
      priorTierKeys: [],
      checks: [],
    };
  }

  const checks = [
    assumptions.riskFreeRate,
    assumptions.equityRiskPremium,
    assumptions.beta,
    assumptions.terminalGrowthCeiling,
  ].map(toCheck);

  const priorTierKeys = checks.filter((check) => check.tier === "prior").map((check) => check.key);
  const priorCount = priorTierKeys.length;
  const defensibleCount = checks.length - priorCount;

  const status: AssumptionProvenanceStatus = priorCount === 0
    ? "defensible"
    : priorCount === checks.length
      ? "prior-dependent"
      : "mixed";

  const summary = priorCount === 0
    ? `All ${checks.length} capital-cost inputs are estimated from held data or attributable to a dated source.`
    : priorCount === checks.length
      ? `Every capital-cost input rests on an undated prior (${priorTierKeys.join(", ")}); the discount rate is an assumption, not an observation.`
      : `${defensibleCount} of ${checks.length} capital-cost inputs are defensible; ${priorCount} rest on undated priors (${priorTierKeys.join(", ")}).`;

  return { status, summary, defensibleCount, priorCount, priorTierKeys, checks };
}
