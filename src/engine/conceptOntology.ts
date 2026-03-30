import { RawPeriodData } from "./types";
import { findRawMetric, listRawBaseKeys } from "./rawMetricTools";

export interface ConceptDefinition {
  id: string;
  label: string;
  statement: "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Derived";
  aliases: string[];
  valuationRelevance: "core" | "supporting" | "optional";
  sectorRelevance?: string[];
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

export const CONCEPT_ONTOLOGY: ConceptDefinition[] = [
  { id: "revenue", label: "Revenue", statement: "ProfitLoss", aliases: ["Revenue From Operations", "Total Revenue from Operations", "Revenue From Operations(Net)", "Net Sale of Products"], valuationRelevance: "core" },
  { id: "pat", label: "Profit after tax", statement: "ProfitLoss", aliases: ["Profit After Tax", "Profit Attributable to Ordinary Shareholders", "Profit Attributable to Shareholders"], valuationRelevance: "core" },
  { id: "equity", label: "Book equity", statement: "BalanceSheet", aliases: ["Total Equity", "Shareholders Funds", "Equity Share Capital", "Total Reserve & Surplus"], valuationRelevance: "core" },
  { id: "ppe", label: "Property plant and equipment", statement: "BalanceSheet", aliases: ["Property, Plant and Equipment", "Gross Property, plant and equipment", "Fixed Assets"], valuationRelevance: "core" },
  { id: "inventory", label: "Inventory", statement: "BalanceSheet", aliases: ["Inventory", "Inventories"], valuationRelevance: "supporting" },
  { id: "receivables", label: "Trade receivables", statement: "BalanceSheet", aliases: ["Trade Receivables", "Long-term Trade Receivables"], valuationRelevance: "supporting" },
  { id: "payables", label: "Trade payables", statement: "BalanceSheet", aliases: ["Trade Payables", "Sundry Creditors"], valuationRelevance: "supporting" },
  { id: "capex", label: "Capital expenditure", statement: "CashFlow", aliases: ["Purchase of Fixed Assets", "Capital Expenditure", "Of fixed assets"], valuationRelevance: "core" },
  { id: "cfo", label: "Cash from operations", statement: "CashFlow", aliases: ["Net Cash From Operating Activities", "Cash Flow From Operating Activities"], valuationRelevance: "core" },
  { id: "shares", label: "End-period shares", statement: "BalanceSheet", aliases: ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued"], valuationRelevance: "supporting" },
  { id: "roe", label: "Return on equity anchor", statement: "Derived", aliases: ["Earning Per Share - Basic"], valuationRelevance: "optional", sectorRelevance: ["financials"] },
  { id: "loans", label: "Loan book", statement: "BalanceSheet", aliases: ["Loan Assets", "Finance Receivables", "Assets on Hire Purchase"], valuationRelevance: "core", sectorRelevance: ["financials"] },
  { id: "nii", label: "Net interest income", statement: "ProfitLoss", aliases: ["Interest Income", "Interest / Discount on Advances / Bills"], valuationRelevance: "supporting", sectorRelevance: ["financials"] },
];

export function summarizeConceptCoverage(periods: RawPeriodData[] | null | undefined) {
  const latest = periods?.[periods.length - 1] ?? null;
  const rows = CONCEPT_ONTOLOGY.map((concept) => {
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
