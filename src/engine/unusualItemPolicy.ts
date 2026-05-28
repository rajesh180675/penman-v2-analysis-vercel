import { RawPeriodData, RecastPeriod, Severity, UnusualItemBucket, UnusualItemPolicySummary } from "./types";

export const UNUSUAL_ITEM_POLICY_VERSION = "2026-06-phase8";

// ─── Gap 3 / PR-C — taxonomy + classifier ───────────────────────────────────
//
// Each classification rule is a (category, rationale, regexes) tuple. Patterns
// use word boundaries (\b) so "interest" doesn't match "interest-rate hedge"
// unless the latter is a separate token. First match wins; if multiple rules
// match the same label, we record the alternative in `rationale`.

export type UnusualItemCategory =
  | "asset-sale-gain-loss"
  | "fair-value-change"
  | "impairment"
  | "litigation"
  | "restructuring"
  | "demerger-scheme-effect"
  | "one-time-tax"
  | "discontinued-operations"
  | "buyback"
  | "special-dividend"
  | "capital-return"
  | "unclassified";

export interface ClassificationRule {
  category: UnusualItemCategory;
  patterns: RegExp[];
  /** Per-category default rationale; the actual matched pattern is appended. */
  rationaleTemplate: string;
  affectsCoreOI: boolean;
  affectsTerminalEligibility: boolean;
  affectsCleanSurplus: boolean;
}

/**
 * Per-category rules. Order matters: first match wins, so put more-specific
 * rules above more-generic ones.
 */
export const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    category: "demerger-scheme-effect",
    patterns: [/\bdemerger\b/i, /\bscheme of (?:arrangement|amalgamation|merger)\b/i, /\bspin[- ]off\b/i],
    rationaleTemplate: "Matches a demerger / scheme-of-arrangement label; period is not a valid terminal anchor.",
    affectsCoreOI: true, affectsTerminalEligibility: true, affectsCleanSurplus: true,
  },
  {
    category: "discontinued-operations",
    patterns: [/\bdiscontinued operations?\b/i, /\bdiscontinuance of operations?\b/i],
    rationaleTemplate: "Discontinued-operations result; excluded from Core OI and not eligible as a terminal anchor.",
    affectsCoreOI: true, affectsTerminalEligibility: true, affectsCleanSurplus: false,
  },
  {
    category: "impairment",
    patterns: [/\bimpairment(?: loss)?\b/i, /\bgoodwill impairment\b/i, /\bwrite[- ]down\b/i, /\bwrite[- ]off\b/i],
    rationaleTemplate: "Impairment / write-down — non-recurring; excluded from Core OI.",
    affectsCoreOI: true, affectsTerminalEligibility: false, affectsCleanSurplus: false,
  },
  {
    category: "asset-sale-gain-loss",
    patterns: [/\b(?:profit|gain|loss) on sale of (?:fixed asset|investment|property|land|building|subsidiary|business)/i, /\bdivest(?:ment|iture)\b/i],
    rationaleTemplate: "Gain/loss on asset disposal — non-operating; excluded from Core OI.",
    affectsCoreOI: true, affectsTerminalEligibility: false, affectsCleanSurplus: false,
  },
  {
    category: "fair-value-change",
    patterns: [/\bfair value (?:change|gain|loss|adjustment|remeasurement)/i, /\bmark[- ]to[- ]market\b/i, /\bMTM\b/],
    rationaleTemplate: "Fair-value remeasurement — non-cash, non-operating; excluded from Core OI.",
    affectsCoreOI: true, affectsTerminalEligibility: false, affectsCleanSurplus: true,
  },
  {
    category: "litigation",
    patterns: [/\blitigation\b/i, /\bsettlement (?:cost|charge|expense)/i, /\blegal (?:claim|provision|settlement)/i],
    rationaleTemplate: "Litigation / settlement charge — non-recurring; excluded from Core OI.",
    affectsCoreOI: true, affectsTerminalEligibility: false, affectsCleanSurplus: false,
  },
  {
    category: "restructuring",
    patterns: [/\brestructuring (?:cost|charge|expense)/i, /\bseverance\b/i, /\bvoluntary retirement scheme\b/i, /\bVRS\b/],
    rationaleTemplate: "Restructuring / severance charge — non-recurring; excluded from Core OI.",
    affectsCoreOI: true, affectsTerminalEligibility: false, affectsCleanSurplus: false,
  },
  {
    category: "one-time-tax",
    patterns: [/\bone[- ]time tax\b/i, /\bdeferred tax remeasurement\b/i, /\btax (?:settlement|reassessment|amnesty)/i],
    rationaleTemplate: "One-time tax charge / refund — non-recurring; excluded from Core OI.",
    affectsCoreOI: true, affectsTerminalEligibility: false, affectsCleanSurplus: false,
  },
  {
    category: "buyback",
    patterns: [/\bbuy[- ]?back\b/i, /\bshare repurchase\b/i, /\bpurchase of own shares\b/i],
    rationaleTemplate: "Share buyback — capital transaction; period flagged for terminal eligibility.",
    affectsCoreOI: false, affectsTerminalEligibility: true, affectsCleanSurplus: false,
  },
  {
    category: "special-dividend",
    patterns: [/\bspecial dividend\b/i, /\binterim dividend\b/i, /\bextraordinary dividend\b/i],
    rationaleTemplate: "Special dividend — outsized payout; flagged for review.",
    affectsCoreOI: false, affectsTerminalEligibility: false, affectsCleanSurplus: false,
  },
  {
    category: "capital-return",
    patterns: [/\bcapital reduction\b/i, /\breturn of capital\b/i, /\brights issue\b/i, /\bbonus issue\b/i],
    rationaleTemplate: "Capital structure change — period flagged for terminal eligibility.",
    affectsCoreOI: false, affectsTerminalEligibility: true, affectsCleanSurplus: false,
  },
];

export interface UnusualItemClassification {
  period: string;
  rawLabel: string;
  value: number;
  category: UnusualItemCategory;
  affectsCoreOI: boolean;
  affectsTerminalEligibility: boolean;
  affectsCleanSurplus: boolean;
  classificationSource: "rule-based" | "heuristic" | "manual";
  rationale: string;
  matchedPattern?: string | undefined;
}

/** Hard cap on classifications surfaced; over this we truncate and flag. */
export const MAX_UNUSUAL_ITEM_CLASSIFICATIONS = 500;

export interface UnusualItemManifest {
  totalUnusualImpactOnCoreOI: number;
  terminalEligibilityBlocked: boolean;
  classifications: UnusualItemClassification[];
  unclassifiedCount: number;
  truncated: boolean;
}

/**
 * Classify raw "exceptional / extraordinary / unusual" labels that the
 * parser surfaced for each period. We scan each raw label once against the
 * ordered rule set and emit a classification per match. Labels that fail to
 * match any rule are tallied as `unclassifiedCount`.
 *
 * The set of labels we scan is deliberately narrow: only labels whose
 * normalized form contains a marker word like "exceptional", "extraordinary",
 * "unusual", "non-recurring", "one-off", "impairment", "buyback", or matches
 * one of the explicit rule keywords. We don't scan every raw metric — that
 * would generate too many false positives.
 */
export function classifyRunUnusualItems(
  recastData: RecastPeriod[],
  rawMetrics: RawPeriodData[],
): UnusualItemClassification[] {
  const out: UnusualItemClassification[] = [];

  for (const period of rawMetrics) {
    for (const [compositeKey, value] of Object.entries(period.raw_metric_values ?? {})) {
      if (value == null || !Number.isFinite(value) || value === 0) continue;
      const baseKey = compositeKey.split("__")[0];
      // Quick screen: only consider labels that hint at unusualness.
      if (!isCandidateLabel(baseKey)) continue;
      const matched = findRule(baseKey);
      if (matched) {
        const { rule, pattern } = matched;
        out.push({
          period: period.period_end,
          rawLabel: baseKey,
          value,
          category: rule.category,
          affectsCoreOI: rule.affectsCoreOI,
          affectsTerminalEligibility: rule.affectsTerminalEligibility,
          affectsCleanSurplus: rule.affectsCleanSurplus,
          classificationSource: "rule-based",
          rationale: `${rule.rationaleTemplate} (matched /${pattern.source}/)`,
          matchedPattern: pattern.source,
        });
      } else {
        out.push({
          period: period.period_end,
          rawLabel: baseKey,
          value,
          category: "unclassified",
          affectsCoreOI: false,
          affectsTerminalEligibility: false,
          affectsCleanSurplus: false,
          classificationSource: "heuristic",
          rationale: "Label flagged as unusual by keyword screen but did not match any classification rule.",
        });
      }
    }
  }

  // Cross-check against recast spec_flags: any period whose spec_flag carries
  // affects_terminal flips terminalEligibilityBlocked at manifest level. We
  // attribute those flags to the period as a synthetic "capital-return"
  // classification so reviewers see them in the manifest.
  for (const period of recastData) {
    for (const flag of period.spec_flags ?? []) {
      if (!flag.affects_terminal) continue;
      out.push({
        period: period.period_end,
        rawLabel: flag.label,
        value: 0,
        category: "capital-return",
        affectsCoreOI: false,
        affectsTerminalEligibility: true,
        affectsCleanSurplus: false,
        classificationSource: "rule-based",
        rationale: `Recast spec_flag ${flag.label}: ${flag.message ?? "marked as affecting terminal anchor"}.`,
      });
    }
  }

  return out;
}

const CANDIDATE_KEYWORDS = [
  "exceptional", "extraordinary", "unusual", "non-recurring", "non recurring",
  "one-off", "one off", "one-time", "one time",
  "impairment", "write-off", "write off", "write-down", "write down",
  "buyback", "buy-back", "buy back",
  "demerger", "discontinued", "restructuring", "litigation", "settlement",
  "fair value", "mark-to-market", "mtm",
  "gain on sale", "loss on sale", "profit on sale",
  "special dividend", "rights issue", "bonus issue", "capital reduction",
];

function isCandidateLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return CANDIDATE_KEYWORDS.some((kw) => lower.includes(kw));
}

function findRule(label: string): { rule: ClassificationRule; pattern: RegExp } | null {
  for (const rule of CLASSIFICATION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(label)) {
        return { rule, pattern };
      }
    }
  }
  return null;
}

/**
 * Aggregate classifications into the envelope manifest. Capped at
 * MAX_UNUSUAL_ITEM_CLASSIFICATIONS.
 */
export function summarizeUnusualItemManifest(
  recastData: RecastPeriod[],
  rawMetrics: RawPeriodData[],
): UnusualItemManifest {
  const all = classifyRunUnusualItems(recastData, rawMetrics);
  const truncated = all.length > MAX_UNUSUAL_ITEM_CLASSIFICATIONS;
  const capped = truncated ? all.slice(0, MAX_UNUSUAL_ITEM_CLASSIFICATIONS) : all;
  const totalImpact = capped
    .filter((c) => c.affectsCoreOI)
    .reduce((sum, c) => sum + Math.abs(c.value), 0);
  const terminalEligibilityBlocked = capped.some((c) => c.affectsTerminalEligibility);
  const unclassifiedCount = capped.filter((c) => c.category === "unclassified").length;
  return {
    totalUnusualImpactOnCoreOI: totalImpact,
    terminalEligibilityBlocked,
    classifications: capped,
    unclassifiedCount,
    truncated,
  };
}

// ─── Existing API (unchanged) ───────────────────────────────────────────────

function terminalFlags(period: RecastPeriod) {
  return (period.spec_flags ?? []).filter((flag) => flag.affects_terminal);
}

function makeBucket(
  type: UnusualItemBucket["type"],
  label: string,
  amount: number,
  recurring: boolean,
  affectsCoreOI: boolean,
  affectsCoreNFE: boolean,
  blocksTerminalValuation: boolean,
  reason: string,
): UnusualItemBucket {
  return { type, label, amount, recurring, affectsCoreOI, affectsCoreNFE, blocksTerminalValuation, reason };
}

export function buildUnusualItemPolicy(period: RecastPeriod): UnusualItemPolicySummary {
  const operatingBuckets: UnusualItemBucket[] = [];
  const financialBuckets: UnusualItemBucket[] = [];

  const exceptionalOperating = period.cu.ExceptionalOperatingItemsAfterTax ?? 0;
  const discontinued = period.cu.DiscontinuedOperationsAfterTax ?? 0;
  const oci = period.cu.OCITotal ?? 0;
  const ufe = period.cu.UFE ?? 0;
  const affectsTerminalFlags = terminalFlags(period);
  const sales = Math.max(Math.abs(period.is?.Sales ?? 0), 1);
  const coreOiAbs = Math.max(Math.abs(period.cu.CoreOI ?? 0), 1);
  const uoiAbs = Math.abs(period.cu.UOI ?? 0);
  const otherItemsAbs = Math.abs(period.is?.OtherItems ?? 0);

  if (exceptionalOperating !== 0) {
    operatingBuckets.push(
      makeBucket(
        "operating_exceptional",
        "Exceptional operating items",
        exceptionalOperating,
        false,
        true,
        false,
        false,
        "Excluded from Core OI as explicitly non-recurring operating noise.",
      ),
    );
  }

  if (discontinued !== 0) {
    operatingBuckets.push(
      makeBucket(
        "discontinued_operations",
        "Discontinued operations",
        discontinued,
        false,
        true,
        false,
        true,
        "Discontinued operations are not valid terminal anchors and stay in UOI only.",
      ),
    );
  }

  if (oci !== 0) {
    operatingBuckets.push(
      makeBucket(
        "oci_reclassified",
        "OCI reclassified as unusual",
        oci,
        false,
        true,
        false,
        false,
        "OCI is excluded from persistent operating income under the current policy configuration.",
      ),
    );
  }

  if (ufe !== 0) {
    financialBuckets.push(
      makeBucket(
        "financial_unusual",
        "Unusual financing items",
        ufe,
        false,
        false,
        true,
        false,
        "Non-operating financing gains/losses remain outside Core NFE.",
      ),
    );
  }

  if (
    uoiAbs > 0
    && (uoiAbs / sales >= 0.05 || uoiAbs / coreOiAbs >= 0.35 || otherItemsAbs / sales >= 0.03)
  ) {
    operatingBuckets.push(
      makeBucket(
        "material_operating_noise",
        "Material company-specific operating noise",
        period.cu.UOI,
        false,
        true,
        false,
        true,
        "Unusual operating noise is large enough to distort terminal valuation if left untreated.",
      ),
    );
  }

  const blockerReasons = affectsTerminalFlags.map((flag) => `${flag.label}: ${flag.message}`);
  if (operatingBuckets.some((bucket) => bucket.type === "material_operating_noise")) {
    blockerReasons.push(
      `Material operating noise detected: UOI=${period.cu.UOI.toFixed(2)} with OtherItems=${(period.is?.OtherItems ?? 0).toFixed(2)}.`,
    );
  }
  if (affectsTerminalFlags.some((flag) => flag.label.includes("CAPITAL_TRANSACTION"))) {
    operatingBuckets.push(
      makeBucket(
        "capital_transaction_signal",
        "Capital transaction signal",
        0,
        false,
        false,
        false,
        true,
        "Terminal valuation should not rely on periods flagged for likely capital transactions or structural remeasurement.",
      ),
    );
  }

  const terminalBlocker =
    operatingBuckets.some((bucket) => bucket.blocksTerminalValuation)
    || affectsTerminalFlags.some((flag) => flag.severity === Severity.CRITICAL);

  return {
    policyVersion: UNUSUAL_ITEM_POLICY_VERSION,
    operatingBuckets,
    financialBuckets,
    operatingTotal: operatingBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
    financialTotal: financialBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
    terminalBlocker,
    blockerReasons,
  };
}
