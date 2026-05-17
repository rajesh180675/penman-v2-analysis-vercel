import { EngineConfig, RawPeriodData } from "./types";
import { SCOPE_POLICY_VERSION } from "./policyVersions";

type ScopeClassification =
  | "supported-industrial"
  | "supported-financial"
  | "unsupported-financial-company"
  | "mixed-financial-conglomerate";
export type AnalysisFamily = "industrial" | "financial-institution";
type ScopeSignalKind = "banking" | "insurance" | "nbfc" | "manual-override";

export interface ScopeSignal {
  kind: ScopeSignalKind;
  key: string;
  periodsObserved: number;
}

export interface ScopeAssessment {
  policyVersion: string;
  classification: ScopeClassification;
  analysisFamily: AnalysisFamily;
  blocked: boolean;
  label: string;
  reasons: string[];
  recommendedAction: string;
  signals: ScopeSignal[];
  /**
   * Phase I8 — single-period screening mode.
   * True when only one period of data was uploaded. The pipeline still
   * runs (not blocked) but time-series signals (growth rates, trend
   * analysis, mean-reversion, V_RE_CV*) are meaningless. The rigor
   * ladder caps at syntactically-valid and the UI surfaces an explicit
   * "screening only" caveat banner.
   */
  screeningOnly?: boolean;
  /** Human-readable explanation of why screening-only mode was triggered. */
  screeningReason?: string;
}

const SIGNAL_GROUPS: Array<{
  kind: Exclude<ScopeSignalKind, "manual-override">;
  label: string;
  keys: string[];
}> = [
  {
    kind: "banking",
    label: "banking",
    keys: [
      "Cash and Balance with RBI",
      "Money at Call and Short Notice",
      "Bills Purchased and Discounted",
      "Investments of Banking Business",
      "Borrowings from RBI",
    ],
  },
  {
    kind: "insurance",
    label: "insurance",
    keys: [
      "Investments of Life Insurance Business",
      "Policy Holder's Investments (Insurance Business)",
      "Assets Held to Cover Linked Liabilities (Insurance Business)",
      "Assets Held to Cover Discontinued Funds (Insurance Business)",
      "Investment - Insurance Operation (Insurance Business)",
      "Cost of Insurance Operation (Insurance Business)",
      "Claims Expenses",
      "Reinsurance Expenses",
      "Premium Earned (Net)",
    ],
  },
  {
    kind: "nbfc",
    label: "nbfc",
    keys: [
      "Interest / Discount on Advances / Bills",
      "Income from Financial Services",
      "Finance Receivables",
      "Loan Assets",
      "Hire Purchase Assets",
      "Lease Assets",
      "Assets on Hire Purchase",
      // Ind-AS NBFC labels (Bajaj Finance, Shriram, Muthoot etc.)
      "Fee and Commission Income",
      "Interests Income (Operating)",
      "Loan to Customer",
    ],
  },
];

function isMaterialValue(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && Math.abs(value) > 0.0001;
}

function countObservedKeys(periods: RawPeriodData[]) {
  const counts = new Map<string, number>();
  for (const period of periods) {
    for (const [compositeKey, value] of Object.entries(period.raw_metric_values ?? {})) {
      if (!isMaterialValue(value)) continue;
      const idx = compositeKey.lastIndexOf("__");
      const baseKey = idx >= 0 ? compositeKey.slice(0, idx) : compositeKey;
      counts.set(baseKey, (counts.get(baseKey) ?? 0) + 1);
    }
  }
  return counts;
}

export function analysisFamilyFromScope(scope: ScopeAssessment): AnalysisFamily {
  return scope.classification === "unsupported-financial-company"
      || scope.classification === "supported-financial"
      || scope.classification === "mixed-financial-conglomerate"
    ? "financial-institution"
    : "industrial";
}

export function assessAnalysisScope(
  periods: RawPeriodData[] | null | undefined,
  config?: Pick<EngineConfig, "financial_institution_mode" | "mixed_conglomerate_route_to"> | null,
): ScopeAssessment {
  const observedCounts = countObservedKeys(periods ?? []);
  const signals: ScopeSignal[] = [];

  // Phase I8 — single-period screening mode.
  // With only one period there are no growth rates, no trend signals,
  // no mean-reversion anchors, and no V_RE_CV* (all require ≥2 periods).
  // We don't block — the pipeline still runs and produces current-period
  // ratios and a point-in-time EPV/Graham-Dodd estimate — but we flag
  // screeningOnly so the rigor ladder caps and the UI shows caveats.
  const periodCount = periods?.length ?? 0;
  const screeningOnly = periodCount === 1;
  const screeningReason = screeningOnly
    ? "Only one period of data was uploaded. Time-series signals (growth rates, trend analysis, mean-reversion, V_RE_CV*) require at least two periods. Results are screening-level only."
    : undefined;

  if (config?.financial_institution_mode) {
    signals.push({
      kind: "manual-override",
      key: "financial_institution_mode",
      periodsObserved: periods?.length ?? 0,
    });
  }

  for (const group of SIGNAL_GROUPS) {
    for (const key of group.keys) {
      const periodsObserved = observedCounts.get(key) ?? 0;
      if (periodsObserved > 0) {
        signals.push({ kind: group.kind, key, periodsObserved });
      }
    }
  }

  if (signals.length === 0) {
    return {
      policyVersion: SCOPE_POLICY_VERSION,
      classification: "supported-industrial",
      analysisFamily: "industrial",
      blocked: false,
      label: "Supported industrial/company scope",
      reasons: [],
      recommendedAction: "Proceed with the industrial Penman-Nissim framework.",
      signals: [],
      screeningOnly,
      screeningReason,
    };
  }

  const grouped = new Map<ScopeSignalKind, ScopeSignal[]>();
  for (const signal of signals) {
    const bucket = grouped.get(signal.kind) ?? [];
    bucket.push(signal);
    grouped.set(signal.kind, bucket);
  }

  const reasons: string[] = [];
  if (grouped.get("manual-override")) {
    reasons.push("Financial-institution mode was explicitly selected.");
  }
  for (const [kind, bucket] of grouped.entries()) {
    if (kind === "manual-override") continue;
    const preview = bucket
      .sort((a, b) => b.periodsObserved - a.periodsObserved || a.key.localeCompare(b.key))
      .slice(0, 3)
      .map((signal) => signal.key)
      .join(", ");
    reasons.push(`Detected ${kind} ledger signals with material values: ${preview}.`);
  }

  // Determine subtype from signal kinds
  const signalKinds = new Set(signals.map(s => s.kind).filter(k => k !== "manual-override"));
  const isBank = signalKinds.has("banking");
  const isInsurance = signalKinds.has("insurance");
  const isNbfc = signalKinds.has("nbfc");

  // Insurance is still unsupported (no pipeline yet)
  if (isInsurance && !isBank && !isNbfc) {
    return {
      policyVersion: SCOPE_POLICY_VERSION,
      classification: "unsupported-financial-company",
      analysisFamily: "financial-institution",
      blocked: true,
      label: "Unsupported insurance scope",
      reasons,
      recommendedAction: "Insurance pipeline not yet implemented. Route to manual analysis.",
      signals: signals.sort((a, b) => b.periodsObserved - a.periodsObserved || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
      screeningOnly,
      screeningReason,
    };
  }

  // Mixed financial conglomerate (e.g., HDFC Group consolidated: bank + insurance + NBFC).
  // Block until the user explicitly chooses a sub-pipeline. Otherwise insurance economics
  // would silently disappear into the bank pipeline (review C4).
  //
  // Heuristic: insurance signals are "material" when at least 2 distinct insurance
  // labels are populated for at least 2 periods OR a single insurance label is
  // populated for 4+ periods. Trivial spillover (e.g., one period with one stray
  // insurance label) is not enough to block.
  if (isInsurance && (isBank || isNbfc)) {
    const insuranceSignals = signals.filter(s => s.kind === "insurance");
    const distinctLabels = insuranceSignals.length;
    const totalPeriodsObserved = insuranceSignals.reduce((sum, s) => sum + s.periodsObserved, 0);
    const isMaterial = (distinctLabels >= 2 && totalPeriodsObserved >= 4)
                    || (distinctLabels >= 1 && totalPeriodsObserved >= 4);

    if (isMaterial) {
      const subPipelineHint = isBank ? "bank" : "NBFC";
      const override = config?.mixed_conglomerate_route_to ?? null;

      // Phase I — honor explicit user override.
      if (override === "bank" || override === "nbfc") {
        return {
          policyVersion: SCOPE_POLICY_VERSION,
          classification: "supported-financial",
          analysisFamily: "financial-institution",
          blocked: false,
          label: `Mixed financial conglomerate routed to ${override} (user override)`,
          reasons: [
            ...reasons,
            `User override: mixed_conglomerate_route_to="${override}". Insurance subsidiary economics will not be modelled separately.`,
          ],
          recommendedAction: override === "bank"
            ? "Bank pipeline (NII decomposition, credit cost, P/B Gordon). Insurance subsidiary contribution to consolidated PAT may distort ROE."
            : "NBFC pipeline (spread analysis, AUM metrics). Insurance subsidiary contribution to consolidated PAT may distort metrics.",
          signals: signals.sort((a, b) => b.periodsObserved - a.periodsObserved || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
          screeningOnly,
          screeningReason,
        };
      }
      if (override === "industrial") {
        return {
          policyVersion: SCOPE_POLICY_VERSION,
          classification: "supported-industrial",
          analysisFamily: "industrial",
          blocked: false,
          label: "Mixed financial conglomerate routed to industrial (user override)",
          reasons: [
            ...reasons,
            `User override: mixed_conglomerate_route_to="industrial". Financial subsidiary economics will be treated as non-core; Penman-Nissim NOA/FA split assumes operating-asset reformulation suits the parent business.`,
          ],
          recommendedAction: "Penman-Nissim industrial framework. Financial subsidiary contribution may produce non-zero NFO; verify subsidiary materiality before relying on RNOA/SPREAD.",
          signals: signals.sort((a, b) => b.periodsObserved - a.periodsObserved || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
          screeningOnly,
          screeningReason,
        };
      }

      // Default: fail-closed (review C4).
      return {
        policyVersion: SCOPE_POLICY_VERSION,
        classification: "mixed-financial-conglomerate",
        analysisFamily: "financial-institution",
        blocked: true,
        label: "Mixed financial conglomerate (insurance + " + (isBank ? "banking" : "NBFC") + ")",
        reasons: [
          ...reasons,
          `Material insurance signals coexist with ${subPipelineHint} signals; routing is ambiguous.`,
        ],
        recommendedAction: `Choose a sub-pipeline explicitly via cfg.mixed_conglomerate_route_to ("bank", "nbfc", or "industrial"), or upload standalone ${subPipelineHint}-only data. Mixed-conglomerate auto-routing is not supported.`,
        signals: signals.sort((a, b) => b.periodsObserved - a.periodsObserved || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
        screeningOnly,
        screeningReason,
      };
    }
    // else: insurance signals are immaterial (e.g., one stray period), fall through
    // to the bank/NBFC pipeline. The reason list still records the insurance hits
    // so reviewers can audit the routing decision.
  }

  // Banks and NBFCs are now supported — route to financial pipeline
  return {
    policyVersion: SCOPE_POLICY_VERSION,
    classification: "supported-financial",
    analysisFamily: "financial-institution",
    blocked: false,
    label: isBank ? "Supported banking scope" : isNbfc ? "Supported NBFC scope" : "Supported financial scope",
    reasons,
    recommendedAction: isBank
      ? "Route to bank analysis pipeline (NII decomposition, credit cost, P/B Gordon)."
      : "Route to NBFC analysis pipeline (spread analysis, AUM metrics, capital adequacy).",
    signals: signals.sort((a, b) => b.periodsObserved - a.periodsObserved || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
    screeningOnly,
    screeningReason,
  };
}
