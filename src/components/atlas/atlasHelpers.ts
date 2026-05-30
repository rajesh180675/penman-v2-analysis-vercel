/**
 * Atlas helpers — bridge between raw_metric_values keys and engine canon.
 *
 * The Capitaline parser emits raw labels (e.g. "Premiums (Insurance Business)")
 * into raw_metric_values. The engine's mappingSpec defines which raw labels
 * map to which canonical fields. Atlas views need:
 *
 *   1. statement classification (BS / PL / CF / Ratio / Other) for grouping
 *   2. engine-mapped flag — does this raw label route to a canonical field?
 *   3. canonical-field name for cross-reference
 *
 * Used by CoverageHeatmap (grouping), MetricInventory (engine-usage badge),
 * and PatternBreakMap (sign convention by statement).
 */
import { CapitalineMappingSpec } from "../../engine/mappingSpec";

export type AtlasStatement = "BS" | "PL" | "CF" | "Ratio" | "Other";

const STATEMENT_LABELS: Record<AtlasStatement, string> = {
  BS: "Balance Sheet",
  PL: "Profit & Loss",
  CF: "Cash Flow",
  Ratio: "Ratios / Per-share",
  Other: "Other / Unmapped",
};

interface MappingEntry {
  canonicalField: string;
  statement: AtlasStatement;
}

/**
 * Recursively walk CapitalineMappingSpec and return a flat
 * Map<rawLabel, {canonicalField, statement}>.
 *
 * The spec has nested groups: balanceSheet.financialAssets.cashAndBank: [...]
 * We flatten the leaf arrays — each string in the array becomes a key.
 */
function buildLookup(): Map<string, MappingEntry> {
  const out = new Map<string, MappingEntry>();

  function walk(node: unknown, path: string[]) {
    if (Array.isArray(node)) {
      // Leaf — array of raw labels
      const canonical = path[path.length - 1];
      if (canonical === undefined) return;
      const root = path[0]?.toLowerCase() ?? "";
      const statement: AtlasStatement = root.includes("balancesheet")
        ? "BS"
        : root.includes("profitloss") || root.includes("incomeStatement".toLowerCase())
        ? "PL"
        : root.includes("cashflow")
        ? "CF"
        : root.includes("ratio") || root.includes("pershare")
        ? "Ratio"
        : "Other";
      for (const label of node as string[]) {
        if (typeof label === "string" && !out.has(label)) {
          out.set(label, { canonicalField: canonical, statement });
        }
      }
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        walk(v, [...path, k]);
      }
    }
  }

  walk(CapitalineMappingSpec, []);
  return out;
}

let _lookup: Map<string, MappingEntry> | null = null;
function getLookup(): Map<string, MappingEntry> {
  if (!_lookup) _lookup = buildLookup();
  return _lookup;
}

/**
 * Classify a raw_metric_values key into a financial statement.
 * Falls back to label-pattern heuristics when not in the mappingSpec.
 */
export function classifyStatement(rawLabel: string): AtlasStatement {
  const direct = getLookup().get(rawLabel);
  if (direct) return direct.statement;

  const lower = rawLabel.toLowerCase();

  // Cash flow
  if (
    lower.includes("cash flow") ||
    lower.includes("cash from") ||
    lower.includes("cash used") ||
    lower.startsWith("cf ") ||
    lower.includes("operating activities") ||
    lower.includes("investing activities") ||
    lower.includes("financing activities")
  ) {
    return "CF";
  }

  // Ratio / per-share
  if (
    lower.includes("ratio") ||
    lower.includes("per share") ||
    lower.includes(" %") ||
    lower.endsWith("%") ||
    lower.startsWith("eps") ||
    lower.includes("(%)") ||
    lower.includes("yield") ||
    lower.includes("margin")
  ) {
    return "Ratio";
  }

  // P&L
  if (
    lower.includes("revenue") ||
    lower.includes("income") ||
    lower.includes("expense") ||
    lower.includes("profit") ||
    lower.includes("sales") ||
    lower.includes("turnover") ||
    lower.includes("interest earned") ||
    lower.includes("interest expended") ||
    lower.includes("premium") ||
    lower.includes("claims") ||
    lower.includes("operating cost") ||
    lower.includes("ebitda") ||
    lower.includes("depreciation") ||
    lower.includes("tax expense") ||
    lower.includes("pat") ||
    lower.includes("pbt")
  ) {
    return "PL";
  }

  // Balance sheet (catch-all for asset / liability nouns)
  if (
    lower.includes("asset") ||
    lower.includes("liabilit") ||
    lower.includes("equity") ||
    lower.includes("borrowings") ||
    lower.includes("loans") ||
    lower.includes("deposits") ||
    lower.includes("investments") ||
    lower.includes("reserves") ||
    lower.includes("provisions") ||
    lower.includes("payable") ||
    lower.includes("receivable") ||
    lower.includes("inventory") ||
    lower.includes("goodwill") ||
    lower.includes("ppe") ||
    lower.includes("intangible")
  ) {
    return "BS";
  }

  return "Other";
}

/**
 * Returns the canonical engine field if this raw label is wired in
 * mappingSpec. Returns null if the label is unmapped (data-only).
 */
export function engineCanonical(rawLabel: string): string | null {
  return getLookup().get(rawLabel)?.canonicalField ?? null;
}

/**
 * True if the raw label is wired into the engine's mappingSpec.
 * Useful for the "engine-mapped vs raw-only" badge in MetricInventory.
 */
export function isEngineMapped(rawLabel: string): boolean {
  return getLookup().has(rawLabel);
}

export function statementLabel(s: AtlasStatement): string {
  return STATEMENT_LABELS[s];
}

/**
 * Sign convention: when a metric increases, is that good news or bad?
 * Used by PatternBreakMap to color anomalies by economic interpretation,
 * not just by signed deviation.
 *
 *   "up-good"  — bigger is better (revenue, profit, ROE, AUM, deposits)
 *   "up-bad"   — bigger is worse  (NPL, GNPA, provisions, debt, claims)
 *   "neutral"  — direction is context-dependent (working capital, cash)
 */
export type SignConvention = "up-good" | "up-bad" | "neutral";

export function signConvention(rawLabel: string): SignConvention {
  const lower = rawLabel.toLowerCase();

  // Bad-when-up: regulatory / loss / risk metrics
  const badNeedles = [
    "npa", "npl", "stage 3", "stage 2", "default",
    "provision", "impair", "write-off", "writeoff", "writedown",
    "claim", "loss given default", "lgd",
    "gross npa", "gross stage",
    "borrowings", "debt", "leverage",
    "cost ratio", "cost-to-income", "cost to income",
    "expense ratio",
  ];
  for (const n of badNeedles) {
    if (lower.includes(n)) return "up-bad";
  }

  // Neutral: working-capital, cash composition, accounting items
  const neutralNeedles = [
    "working capital", "current asset", "current liabilit",
    "tax", "deferred", "share capital", "reserves and surplus",
    "minority", "ocig", "fvtoci",
  ];
  for (const n of neutralNeedles) {
    if (lower.includes(n)) return "neutral";
  }

  return "up-good";
}
