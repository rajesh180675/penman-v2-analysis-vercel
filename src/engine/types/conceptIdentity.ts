/* Pure type leaf — concept identity summary.
   Relocated from logic module(s) to break the types-barrel <-> analysisTraceability
   cycle (weakness #1). Self-contained.
   Contains ONLY types (no runtime values), imports only other pure leaves, so it
   can never re-enter the engine's type->logic->type tangle. The originating logic
   module re-exports these names, so existing import paths stay valid. */

/** BS = Balance Sheet, IS = Income Statement, CF = Cash Flow, SD = Statement of Derived. */
export type StatementOwner = "BS" | "IS" | "CF" | "SD";

export type SignConvention = "asset" | "liability" | "income" | "expense" | "flow";

export type AggregationBehavior = "sum" | "latest" | "none";

export type DataProvider = "Capitaline" | "Screener" | "XBRL" | "JSON" | "Manual";

export interface ConceptDefinition {
  id: string;
  label: string;
  statement: "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Derived";
  /** Derived from `statement`. Surfaced explicitly so identity checks don't
   *  re-derive at every call site. */
  statementOwner: StatementOwner;
  signConvention: SignConvention;
  aggregationBehavior: AggregationBehavior;
  aliases: string[];
  valuationRelevance: "core" | "supporting" | "optional";
  sectorRelevance?: string[] | undefined;
  /** Empty / absent = applicable to every provider. */
  providerRelevance?: DataProvider[] | undefined;
}

export type ConflictClass =
  | "exact"
  | "alias"
  | "fuzzy-review"
  | "cross-statement-conflict"
  | "duplicate-source"
  | "unresolved";

export interface ConceptConflict {
  conceptId: string;
  conflictClass: ConflictClass;
  rawLabels: string[];
  statements: StatementOwner[];
  affectedPeriods: string[];
  resolution?: string | undefined;
}

export interface ConceptIdentitySummary {
  status: "clean" | "conflicts-present" | "valuation-blocked";
  conflictCount: number;
  unresolvedCriticalCount: number;
  conflicts: ConceptConflict[];
  truncated: boolean;
}
