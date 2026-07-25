import { EngineConfig, RawPeriodData } from "./types";
import { SCOPE_POLICY_VERSION } from "./policyVersions";

type ScopeClassification =
  | "supported-industrial"
  | "supported-financial"
  | "unsupported-financial-company"
  | "mixed-financial-conglomerate"
  // Phase 0 — industrial-family companies in sectors the engine can ingest
  // and ratio-band correctly, but has NO sector-native valuation model for.
  // They stay analysisFamily "industrial" (the Penman-Nissim recast still
  // runs) but the rigor ladder is capped at economically-plausible so the
  // industrial intrinsic value is produced-but-not-blessed. See
  // INDUSTRIAL_SECTOR_GROUPS and docs/sector-native-modelling-plan.md.
  | "detected-telecom-unmodelled"
  | "detected-utility-unmodelled";
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
  screeningOnly?: boolean | undefined;
  /** Human-readable explanation of why screening-only mode was triggered. */
  screeningReason?: string | undefined;
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
      // "Fee and Commission Income" excluded — it appears in many industrial
  // companies (ITC, Reliance, holding companies) as immaterial incidental
  // income. Including it caused false NBFC positives. Only true NBFC
  // funding/advance labels remain as triggers.
  // "Fee and Commission Income",
      "Interests Income (Operating)",
      // X-Detail BS format: "Loans - Long - Term" is the parent loan book and
      // "Loan to Customer" is a sub-category (often zero; the parent carries
      // the actual balance). Both must stay: "Loans - Long - Term" is the
      // ONLY material NBFC label Bajaj Finance reports (₹407,844 Cr across 16
      // periods), so removing it drops Bajaj below the 2-distinct-key
      // threshold and misroutes a real NBFC to the industrial pipeline.
      // Conglomerates that carry subsidiary loans (Grasim) are separated by the
      // explicit company_type override, not by narrowing this list.
      "Loans - Long - Term",
      "Loan to Customer",
      "Finance Lease Receivables",
      "Total Loans Given",
    ],
  },
];

function isMaterialValue(value: number | null | undefined) {
  // Threshold: 1 Cr minimum for Cr-denominated data.
  // The old 0.0001 threshold (Rs 1,000) caused false NBFC positives for
  // industrial companies with trivial fee income lines.
  return value != null && Number.isFinite(value) && Math.abs(value) >= 1.0;
}

// Phase 0 — industrial-subsector fail-safe. These companies route through the
// industrial Penman-Nissim pipeline (analysisFamily "industrial") but the
// engine has no sector-native valuation model for them, so the rigor ladder
// is capped at economically-plausible downstream (see analysisTraceability).
//
// Labels are VERIFIED clean discriminators read from real Capitaline exports
// (Vodafone Idea, NTPC, Power Grid), NOT theorized:
//   utility → "Regulatory Deferral Account" (Ind-AS 114 rate-regulated; unique
//             to rate-base utilities — NTPC 18,730 Cr / Power Grid 9,876 Cr).
//   telecom → "Direct Tele Communication / Network Development Expenses"
//             (Vodafone Idea 5,772 Cr — the one telecom-exclusive opex line).
// Deliberately NOT used as triggers: "Rights Under Licensing Agreement" /
// "License Fee / Operation Charges" — they also appear materially in Power Grid
// (utility), so they would cross-contaminate telecom↔utility. Kept out.
// This table is SEPARATE from SIGNAL_GROUPS: those route to the financial
// family; these must stay industrial. Detection only runs when NO financial
// signal fired (see assessAnalysisScope), so a financial company carrying a
// stray telecom/utility opex line is never reclassified.
const INDUSTRIAL_SECTOR_GROUPS: Array<{
  sector: "telecom" | "utility";
  keys: string[];
}> = [
  {
    sector: "utility",
    keys: [
      "Regulatory Deferral Account - Debit Balance",
      "Regulatory Deferral Account - Credit Balance",
    ],
  },
  {
    sector: "telecom",
    keys: ["Direct Tele Communication / Network Development Expenses"],
  },
];

/**
 * Detect a known-but-unmodelled industrial subsector (telecom/utility) from the
 * observed material ledger keys. Conservative: requires the discriminator to be
 * material in >= 2 periods (a single stray period does not trigger), mirroring
 * the materiality discipline used for the financial SIGNAL_GROUPS. Returns the
 * first matching sector or null.
 */
function detectIndustrialSubsector(
  observedCounts: Map<string, number>,
): "telecom" | "utility" | null {
  for (const group of INDUSTRIAL_SECTOR_GROUPS) {
    const periodsObserved = Math.max(
      0,
      ...group.keys.map((key) => observedCounts.get(key) ?? 0),
    );
    if (periodsObserved >= 2) return group.sector;
  }
  return null;
}

/**
 * Build the ScopeAssessment for a detected-but-unmodelled industrial subsector.
 * blocked stays FALSE (the recast + sector-correct ratios still run); the
 * downstream rigor-ladder cap (analysisTraceability) is what prevents a blessed
 * valuation. `source` distinguishes an explicit company_type from auto-detection
 * for the reason text only.
 */
function buildUnmodelledSectorScope(params: {
  sector: "telecom" | "utility";
  signals: ScopeSignal[];
  screeningOnly: boolean | undefined;
  screeningReason: string | undefined;
  source: "explicit" | "detected";
}): ScopeAssessment {
  const { sector, signals, screeningOnly, screeningReason, source } = params;
  const classification: ScopeClassification =
    sector === "utility" ? "detected-utility-unmodelled" : "detected-telecom-unmodelled";
  const origin = source === "explicit"
    ? `User selected company_type "${sector}"`
    : `Detected ${sector} ledger signals in source data`;
  return {
    policyVersion: SCOPE_POLICY_VERSION,
    classification,
    analysisFamily: "industrial",
    blocked: false,
    label: `Detected ${sector} — no sector-native valuation model`,
    reasons: [
      `${origin}. The engine ingests ${sector} data and applies ${sector} ratio bands, but has no ${sector}-native valuation model — the industrial Penman-Nissim NOA/kw reformulation is not faithful for ${sector === "utility" ? "rate-regulated rate-base" : "spectrum/licence/AGR"} structures. The run is capped at economically-plausible; the intrinsic value is produced but not valuation-eligible.`,
    ],
    recommendedAction: `Treat ${sector} ratios as sector-correct, but do not rely on the industrial intrinsic value — it is capped below valuation-eligible until a ${sector}-native model ships.`,
    signals,
    screeningOnly,
    screeningReason,
  };
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
  config?: Pick<EngineConfig, "financial_institution_mode" | "mixed_conglomerate_route_to" | "company_type"> | null,
): ScopeAssessment {
  const observedCounts = countObservedKeys(periods ?? []);
  const signals: ScopeSignal[] = [];

  // Phase I8 — single-period screening mode.
  const periodCount = periods?.length ?? 0;
  const screeningOnly = periodCount === 1;
  const screeningReason = screeningOnly
    ? "Only one period of data was uploaded. Time-series signals (growth rates, trend analysis, mean-reversion, V_RE_CV*) require at least two periods. Results are screening-level only."
    : undefined;

  for (const group of SIGNAL_GROUPS) {
    for (const key of group.keys) {
      const periodsObserved = observedCounts.get(key) ?? 0;
      if (periodsObserved > 0) {
        signals.push({ kind: group.kind, key, periodsObserved });
      }
    }
  }

  const observedFinancialKinds = new Set(signals.map((signal) => signal.kind));

  // Phase D2 — explicit company_type is an unconditional user override.
  // When the user manually selects a type, trust their judgment completely.
  // Signal detection only runs when company_type === "auto".
  // Rationale: Penman-Nissim handles financial assets in industrial companies
  // by design (OA/FA split). Routing Reliance or Tata Steel to the bank
  // pipeline because they have "Loans Given" from subsidiaries is wrong —
  // the framework already separates operating from financial economics.
  const ct = config?.company_type;
  if (ct && ct !== "auto") {
    // Phase 0 — explicit telecom/utility selection routes to the capped
    // industrial scope (no sector-native valuation model yet).
    if (ct === "telecom" || ct === "utility") {
      return buildUnmodelledSectorScope({
        sector: ct,
        signals: [...signals],
        screeningOnly,
        screeningReason,
        source: "explicit",
      });
    }
    const financialTypes = ["bank", "nbfc", "insurance"] as const;
    const isFinancial = (financialTypes as readonly string[]).includes(ct);
    const kind: ScopeSignalKind = ct === "bank" ? "banking"
      : ct === "nbfc" ? "nbfc"
      : ct === "insurance" ? "insurance"
      : "manual-override";

    const overrideSignals = [...signals];
    if (isFinancial) {
      overrideSignals.push({ kind, key: `company_type:${ct}`, periodsObserved: periodCount });
    }

    const classification: ScopeClassification = isFinancial
      ? "supported-financial"
      : "supported-industrial";

    return {
      policyVersion: SCOPE_POLICY_VERSION,
      classification,
      analysisFamily: isFinancial ? "financial-institution" : "industrial",
      blocked: false,
      label: `Explicit company type: ${ct}`,
      reasons: [`User selected "${ct}" — manual override, no signal detection applied.`],
      recommendedAction: isFinancial
        ? `Proceed with ${ct} pipeline.`
        : "Proceed with the industrial Penman-Nissim framework.",
      signals: overrideSignals,
      screeningOnly,
      screeningReason,
    };
  }

  if (config?.financial_institution_mode) {
    signals.push({
      kind: "manual-override",
      key: "financial_institution_mode",
      periodsObserved: periods?.length ?? 0,
    });
  }

  if (signals.length === 0) {
    // Phase 0 — before declaring plain industrial, check for a known-but-
    // unmodelled industrial subsector (telecom/utility). This runs ONLY when no
    // financial signal fired, so a bank/NBFC/insurer carrying a stray telecom or
    // utility opex line is never reclassified here.
    const subsector = detectIndustrialSubsector(observedCounts);
    if (subsector) {
      return buildUnmodelledSectorScope({
        sector: subsector,
        signals: [],
        screeningOnly,
        screeningReason,
        source: "detected",
      });
    }
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
  if (ct && ct !== "auto" && observedFinancialKinds.size > 0) {
    reasons.push(`Registry company_type "${ct}" contradicts detected financial ledger signals; routing by source data.`);
  }
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

  // NBFC detection requires at least 2 distinct NBFC signal keys.
  // A single key (especially "Loans - Long - Term") appears materially in
  // many industrial companies as subsidiary/staff loans and is not a
  // reliable NBFC discriminator. Requiring co-occurrence mirrors the
  // insurance materiality heuristic and prevents false positives like
  // Bharti Airtel, Titan, Dabur, and Tata Steel being misrouted to the
  // bank pipeline.
  const nbfcSignalCount = signals.filter(s => s.kind === "nbfc")
    .reduce((distinct, s) => distinct.add(s.key), new Set<string>()).size;
  const isNbfc = nbfcSignalCount >= 2;

  // When nbfc signals exist but don't meet the 2-key threshold, strip them
  // so the company falls through to industrial classification instead of
  // being routed to the financial pipeline with a lone false-positive key.
  if (!isNbfc && nbfcSignalCount > 0 && !isBank && !isInsurance) {
    const nbfcKeys = new Set(signals.filter(s => s.kind === "nbfc").map(s => s.key));
    reasons.push(
      `NBFC signal(s) (${[...nbfcKeys].join(", ")}) did not meet the 2-distinct-key threshold; treating as industrial.`
    );
    // Remove nbfc signals so downstream routing sees no financial signals.
    for (let i = signals.length - 1; i >= 0; i--) {
      if (signals[i]?.kind === "nbfc") signals.splice(i, 1);
    }
  }

  // Insurance is supported!
  //
  // Deliberately NOT gated behind a 2-distinct-key threshold like NBFC above.
  // Real insurers can surface a single recognised label — LIC's export matches
  // only "Premium Earned (Net)" (its "Claims Incurred" is not the spec's
  // "Claims Expenses"), so a 2-key rule demotes a genuine insurer to the
  // industrial pipeline and its subtype degrades to generic-financial.
  // Conglomerates that carry one insurance-subsidiary line are handled by the
  // explicit company_type override instead: the library picker always supplies
  // a concrete type, and an explicit type skips signal detection entirely.
  if (isInsurance && !isBank && !isNbfc) {
    return {
      policyVersion: SCOPE_POLICY_VERSION,
      classification: "supported-financial",
      analysisFamily: "financial-institution",
      blocked: false,
      label: "Supported insurance scope",
      reasons,
      recommendedAction: "Route to insurance analysis pipeline (claims ratio, combined ratio, float leverage).",
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
    // Two or more distinct insurance labels each seen in ≥ 2 periods,
    // OR a single label dominating 4+ periods — both indicate a material
    // insurance sub-business, not a stray line item.
    const isMaterial = (distinctLabels >= 2 && totalPeriodsObserved >= 2)
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

  // Banks and NBFCs are now supported — route to financial pipeline.
  // If we reach here with no financial signal kinds (bank/nbfc/insurance all
  // false), the lone nbfc signals were stripped above — fall through to
  // industrial instead of misclassifying.
  if (!isBank && !isNbfc && !isInsurance) {
    // Check for unmodelled industrial subsector before defaulting.
    const subsector = detectIndustrialSubsector(observedCounts);
    if (subsector) {
      return buildUnmodelledSectorScope({
        sector: subsector,
        signals: [],
        screeningOnly,
        screeningReason,
        source: "detected",
      });
    }
    return {
      policyVersion: SCOPE_POLICY_VERSION,
      classification: "supported-industrial",
      analysisFamily: "industrial",
      blocked: false,
      label: "Supported industrial/company scope",
      reasons,
      recommendedAction: "Proceed with the industrial Penman-Nissim framework.",
      signals: [],
      screeningOnly,
      screeningReason,
    };
  }

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
