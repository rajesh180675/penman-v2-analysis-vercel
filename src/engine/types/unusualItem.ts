/* Pure type leaf — unusual item manifest.
   Relocated from logic module(s) to break the types-barrel <-> analysisTraceability
   cycle (weakness #1). Self-contained.
   Contains ONLY types (no runtime values), imports only other pure leaves, so it
   can never re-enter the engine's type->logic->type tangle. The originating logic
   module re-exports these names, so existing import paths stay valid. */

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

export interface UnusualItemManifest {
  totalUnusualImpactOnCoreOI: number;
  terminalEligibilityBlocked: boolean;
  classifications: UnusualItemClassification[];
  unclassifiedCount: number;
  truncated: boolean;
}
