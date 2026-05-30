import { RawPeriodData } from "./types";
import { findRawMetric, listRawBaseKeys } from "./rawMetricTools";

// Types relocated to ./types/conceptIdentity (pure leaf, weakness #1 cycle break).
// Imported back for internal use; re-exported so existing "./conceptOntology" paths stay valid.
import type {
  StatementOwner,
  ConflictClass,
  ConceptConflict,
  ConceptIdentitySummary,
} from "./types/conceptIdentity";
export type {
  StatementOwner,
  ConflictClass,
  ConceptConflict,
  ConceptIdentitySummary,
};

// ─── Type extensions (Gap 1 / PR-A) ─────────────────────────────────────────
//
// These fields make every concept's economic identity explicit. Plan v4
// (PR-A) ships them so each metric has exactly one (statementOwner, sign,
// aggregation) tuple — the "concept identity" that the rest of the
// ladder can rely on.

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

export interface ConceptCoverageRow {
  conceptId: string;
  label: string;
  matched: boolean;
  matchedKey: string | null;
  valuationRelevance: ConceptDefinition["valuationRelevance"];
}

export interface ConceptCoverageSummary {
  matchedCount: number;
  totalCount: number;
  coreMatchedCount: number;
  coreTotalCount: number;
  coveragePct: number;
  unresolvedCore: string[];
  rows: ConceptCoverageRow[];
}

// ─── Conflict taxonomy ──────────────────────────────────────────────────────

/** Hard cap on conflicts surfaced; over this we truncate and flag. */
export const MAX_CONCEPT_CONFLICTS = 200;

// ─── Concept ontology ───────────────────────────────────────────────────────
//
// Each entry is a (id, statement, sign, aggregation, aliases) row. Adding a
// new entry MUST stay self-consistent: the same alias may not appear under
// two different `statementOwner` values — `detectConflicts` will surface
// that as a `cross-statement-conflict`.

const ASSET_LATEST = { signConvention: "asset" as const, aggregationBehavior: "latest" as const };
const LIABILITY_LATEST = { signConvention: "liability" as const, aggregationBehavior: "latest" as const };
const INCOME_SUM = { signConvention: "income" as const, aggregationBehavior: "sum" as const };
const EXPENSE_SUM = { signConvention: "expense" as const, aggregationBehavior: "sum" as const };
const FLOW_SUM = { signConvention: "flow" as const, aggregationBehavior: "sum" as const };
const DERIVED_NONE = { signConvention: "flow" as const, aggregationBehavior: "none" as const };

export const CONCEPT_ONTOLOGY: ConceptDefinition[] = [
  // ─── Income statement ──────────────────────────────────────────────────
  { id: "revenue", label: "Revenue", statement: "ProfitLoss", statementOwner: "IS", ...INCOME_SUM, aliases: ["Revenue From Operations", "Total Revenue from Operations", "Revenue From Operations(Net)", "Net Sale of Products"], valuationRelevance: "core" },
  { id: "pat", label: "Profit after tax", statement: "ProfitLoss", statementOwner: "IS", ...INCOME_SUM, aliases: ["Profit After Tax", "Profit Attributable to Ordinary Shareholders", "Profit Attributable to Shareholders"], valuationRelevance: "core" },
  { id: "nii", label: "Net interest income", statement: "ProfitLoss", statementOwner: "IS", ...INCOME_SUM, aliases: ["Interest Income", "Interest / Discount on Advances / Bills"], valuationRelevance: "supporting", sectorRelevance: ["financials"] },

  // ─── Balance sheet ─────────────────────────────────────────────────────
  { id: "equity", label: "Book equity", statement: "BalanceSheet", statementOwner: "BS", ...ASSET_LATEST, aliases: ["Total Equity", "Shareholders Funds", "Equity Share Capital", "Total Reserve & Surplus"], valuationRelevance: "core" },
  { id: "ppe", label: "Property plant and equipment", statement: "BalanceSheet", statementOwner: "BS", ...ASSET_LATEST, aliases: ["Property, Plant and Equipment", "Gross Property, plant and equipment", "Fixed Assets"], valuationRelevance: "core" },
  { id: "inventory", label: "Inventory", statement: "BalanceSheet", statementOwner: "BS", ...ASSET_LATEST, aliases: ["Inventory", "Inventories"], valuationRelevance: "supporting" },
  { id: "receivables", label: "Trade receivables", statement: "BalanceSheet", statementOwner: "BS", ...ASSET_LATEST, aliases: ["Trade Receivables", "Long-term Trade Receivables"], valuationRelevance: "supporting" },
  { id: "payables", label: "Trade payables", statement: "BalanceSheet", statementOwner: "BS", ...LIABILITY_LATEST, aliases: ["Trade Payables", "Sundry Creditors"], valuationRelevance: "supporting" },
  { id: "shares", label: "End-period shares", statement: "BalanceSheet", statementOwner: "BS", ...ASSET_LATEST, aliases: ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued"], valuationRelevance: "supporting" },
  { id: "loans", label: "Loan book", statement: "BalanceSheet", statementOwner: "BS", ...ASSET_LATEST, aliases: ["Loan Assets", "Finance Receivables", "Assets on Hire Purchase"], valuationRelevance: "core", sectorRelevance: ["financials"] },

  // ─── Cash flow ─────────────────────────────────────────────────────────
  { id: "capex", label: "Capital expenditure", statement: "CashFlow", statementOwner: "CF", ...EXPENSE_SUM, aliases: ["Purchase of Fixed Assets", "Capital Expenditure", "Of fixed assets"], valuationRelevance: "core" },
  { id: "cfo", label: "Cash from operations", statement: "CashFlow", statementOwner: "CF", ...FLOW_SUM, aliases: ["Net Cash From Operating Activities", "Cash Flow From Operating Activities"], valuationRelevance: "core" },

  // ─── Derived (Penman-Nissim core decomposition) ────────────────────────
  // These are computed by the recast layer, so they have no aliases and are
  // not expected to match raw labels. They live in the ontology so identity
  // checks know they exist and so reviewers can see the full canonical map.
  { id: "noa", label: "Net operating assets", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "core" },
  { id: "nfo", label: "Net financial obligations", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "core" },
  { id: "cse", label: "Common shareholders' equity", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "core" },
  { id: "oa", label: "Operating assets", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "supporting" },
  { id: "ol", label: "Operating liabilities", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "supporting" },
  { id: "fa", label: "Financial assets", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "supporting" },
  { id: "fo", label: "Financial obligations", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "supporting" },
  { id: "core_oi", label: "Core operating income", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "core" },
  { id: "uoi", label: "Unusual operating income", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "supporting" },
  { id: "nfe", label: "Net financial expense", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "supporting" },
  { id: "cni", label: "Comprehensive net income", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "supporting" },
  { id: "rnoa", label: "Return on net operating assets", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "core" },
  { id: "fcf", label: "Free cash flow", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: [], valuationRelevance: "core" },

  // ─── Other ─────────────────────────────────────────────────────────────
  { id: "roe", label: "Return on equity anchor", statement: "Derived", statementOwner: "SD", ...DERIVED_NONE, aliases: ["Earning Per Share - Basic"], valuationRelevance: "optional", sectorRelevance: ["financials"] },
];

// ─── Coverage summary (pre-existing API, unchanged) ────────────────────────

export function summarizeConceptCoverage(periods: RawPeriodData[] | null | undefined) {
  const latest = periods?.[periods.length - 1] ?? null;
  // Skip Derived concepts — they're computed, not matched against raw labels.
  const eligible = CONCEPT_ONTOLOGY.filter((concept) => concept.statement !== "Derived");
  const rows = eligible.map((concept) => {
    const match = findRawMetric(latest, concept.aliases);
    return {
      conceptId: concept.id,
      label: concept.label,
      matched: Boolean(match),
      matchedKey: match?.key ?? null,
      valuationRelevance: concept.valuationRelevance,
    } satisfies ConceptCoverageRow;
  });

  const matchedCount = rows.filter((row) => row.matched).length;
  const coreRows = rows.filter((row) => row.valuationRelevance === "core");
  const coreMatchedCount = coreRows.filter((row) => row.matched).length;

  return {
    matchedCount,
    totalCount: rows.length,
    coreMatchedCount,
    coreTotalCount: coreRows.length,
    coveragePct: rows.length ? matchedCount / rows.length : 0,
    unresolvedCore: coreRows.filter((row) => !row.matched).map((row) => row.label),
    rows,
  } satisfies ConceptCoverageSummary;
}

export function rankUnmappedLabels(periods: RawPeriodData[] | null | undefined, limit = 20) {
  const latest = periods?.[periods.length - 1] ?? null;
  if (!latest) return [];
  const knownLabels = new Set(CONCEPT_ONTOLOGY.flatMap((concept) => concept.aliases.map((alias) => alias.toLowerCase())));
  return listRawBaseKeys(latest)
    .filter((label) => !knownLabels.has(label.toLowerCase()))
    .slice(0, limit);
}

// ─── Conflict detection (Gap 1 / PR-A) ──────────────────────────────────────

/**
 * Detect concept-identity conflicts across periods.
 *
 * Conflict classes detected:
 *   - cross-statement-conflict: an alias is shared by two concepts with
 *     different `statementOwner` (this is an ontology bug, not a data bug —
 *     surfaces immediately as a structural issue)
 *   - duplicate-source: two distinct raw labels in the same period both
 *     resolve to the same concept
 *   - unresolved: a concept with `valuationRelevance === "core"` has no
 *     match in the latest period
 *
 * Result is stable-sorted by conceptId for deterministic output.
 */
export function detectConflicts(
  rawData: RawPeriodData[],
  registry: ConceptDefinition[] = CONCEPT_ONTOLOGY,
): ConceptConflict[] {
  const conflicts: ConceptConflict[] = [];

  // 1. Cross-statement conflicts inside the registry itself.
  //    (Same alias on two concepts with different statementOwner.)
  const aliasIndex = new Map<string, ConceptDefinition[]>();
  for (const concept of registry) {
    for (const alias of concept.aliases) {
      const key = alias.toLowerCase();
      const bucket = aliasIndex.get(key) ?? [];
      bucket.push(concept);
      aliasIndex.set(key, bucket);
    }
  }
  for (const [alias, concepts] of aliasIndex) {
    if (concepts.length < 2) continue;
    const distinctOwners = new Set(concepts.map((c) => c.statementOwner));
    if (distinctOwners.size <= 1) continue;
    // Surface one conflict per concept involved so reviewers can resolve
    // both sides. Sorted for determinism.
    const sortedConcepts = [...concepts].sort((a, b) => a.id.localeCompare(b.id));
    for (const concept of sortedConcepts) {
      conflicts.push({
        conceptId: concept.id,
        conflictClass: "cross-statement-conflict",
        rawLabels: [alias],
        statements: [...distinctOwners].sort() as StatementOwner[],
        affectedPeriods: [],
        resolution: `Alias "${alias}" is shared by ${sortedConcepts.length} concepts across ${distinctOwners.size} statements; remove from all but one.`,
      });
    }
  }

  // 2. Duplicate-source conflicts (multiple raw labels resolve to one
  //    concept in the same period).
  for (const period of rawData) {
    const periodKey = period.period_end;
    const baseKeys = listRawBaseKeys(period);
    const baseKeysLower = baseKeys.map((k) => k.toLowerCase());
    for (const concept of registry) {
      if (concept.aliases.length === 0) continue;
      const aliasSet = new Set(concept.aliases.map((a) => a.toLowerCase()));
      const matched: string[] = [];
      for (let i = 0; i < baseKeys.length; i++) {
        if (aliasSet.has(baseKeysLower[i]!)) {
          matched.push(baseKeys[i]!);
        }
      }
      if (matched.length >= 2) {
        conflicts.push({
          conceptId: concept.id,
          conflictClass: "duplicate-source",
          rawLabels: matched,
          statements: [concept.statementOwner],
          affectedPeriods: [periodKey],
          resolution: `Period ${periodKey} resolves "${concept.id}" from ${matched.length} raw labels; pick one canonical source.`,
        });
      }
    }
  }

  // 3. Unresolved critical concepts (core, non-Derived, no match in latest period).
  //    Skip sector-gated concepts (e.g. "loans" is only relevant to financials);
  //    they're conditionally required and we don't carry sector context here.
  const latest = rawData[rawData.length - 1];
  if (latest) {
    for (const concept of registry) {
      if (concept.valuationRelevance !== "core") continue;
      if (concept.statement === "Derived") continue;
      if (concept.aliases.length === 0) continue;
      if (concept.sectorRelevance && concept.sectorRelevance.length > 0) continue;
      const match = findRawMetric(latest, concept.aliases);
      if (!match) {
        conflicts.push({
          conceptId: concept.id,
          conflictClass: "unresolved",
          rawLabels: [],
          statements: [concept.statementOwner],
          affectedPeriods: [latest.period_end],
          resolution: `Required concept "${concept.id}" has no matching raw label in period ${latest.period_end}.`,
        });
      }
    }
  }

  return conflicts.sort((a, b) => {
    if (a.conceptId !== b.conceptId) return a.conceptId.localeCompare(b.conceptId);
    return a.conflictClass.localeCompare(b.conflictClass);
  });
}

// ─── Envelope summary (cap-enforced) ────────────────────────────────────────

/**
 * Build a capped, classified summary of conflicts for the envelope.
 *
 * status semantics:
 *   - "clean" — zero conflicts
 *   - "conflicts-present" — non-critical conflicts only (duplicate-source,
 *     fuzzy-review, etc.)
 *   - "valuation-blocked" — at least one unresolved-critical or
 *     cross-statement conflict exists; rigor cannot reach valuation-eligible
 *     while the block flag is on
 */
export function summarizeConceptIdentity(
  rawData: RawPeriodData[] | null | undefined,
  registry: ConceptDefinition[] = CONCEPT_ONTOLOGY,
): ConceptIdentitySummary {
  const conflicts = detectConflicts(rawData ?? [], registry);
  const unresolvedCritical = conflicts.filter(
    (c) => c.conflictClass === "unresolved" || c.conflictClass === "cross-statement-conflict",
  );
  const truncated = conflicts.length > MAX_CONCEPT_CONFLICTS;
  const capped = truncated ? conflicts.slice(0, MAX_CONCEPT_CONFLICTS) : conflicts;

  let status: ConceptIdentitySummary["status"];
  if (conflicts.length === 0) {
    status = "clean";
  } else if (unresolvedCritical.length === 0) {
    status = "conflicts-present";
  } else {
    status = "valuation-blocked";
  }

  return {
    status,
    conflictCount: conflicts.length,
    unresolvedCriticalCount: unresolvedCritical.length,
    conflicts: capped,
    truncated,
  };
}
