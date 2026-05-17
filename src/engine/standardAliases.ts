/**
 * Multi-Standard Label Aliases — Phase A
 *
 * Indian listed companies have Capitaline data across three accounting standards:
 *   - Ind-AS (FY2017+): canonical labels used by mappingSpec.ts
 *   - Revised Schedule VI (FY2012-FY2017)
 *   - Old GAAP / Standard (pre-FY2012)
 *
 * The HTML structure of the export is identical across standards — only the
 * line-item labels differ. To extend the engine to 15-year history without
 * rewriting mappingSpec.ts for each standard, we use an alias-and-emit
 * strategy:
 *
 *   - Parser detects the source standard from filename (INDAS, REV, default
 *     STD).
 *   - When a row's metric name matches an alias source, the parser ALSO
 *     emits the Ind-AS canonical label as a synthetic composite key in
 *     parallel, with the original label preserved for traceability.
 *   - All downstream code (mappingSpec, recast, ratios, valuation) keeps
 *     looking for the Ind-AS canonical label and finds it transparently.
 *
 * Provenance is tracked on RawPeriodData.accounting_standard so the rigor
 * envelope can mark pre-Ind-AS periods at lower confidence (no Ind AS 116
 * leases, no expected credit loss, no FVTPL/FVTOCI, no OCI).
 *
 * NOTE: This does NOT solve mapping for pre-Ind-AS-only labels (e.g.
 * "Application Money Pending Allotment" before Ind-AS). It only bridges
 * labels that have a clean canonical equivalent. Coverage list is
 * deliberately conservative — better to miss a label than mis-map it.
 */

export type AccountingStandard =
  | "ind-as"
  | "revised-sch-vi"
  | "standard"
  | "unknown";

/**
 * Filename suffix → accounting standard.
 * Capitaline emits files like:
 *   BalanceSheetINDAS_.xls       → ind-as
 *   BalanceSheetREV_.xls         → revised-sch-vi
 *   BalanceSheet_.xls            → standard (default, pre-2012 export)
 *   ProfitLossSTD_.xls           → standard (some exports use STD suffix)
 *   CashFlow_.xls                → ambiguous; CF format barely changed
 *                                  across standards, treat as "unknown"
 *                                  unless suffix is present
 */
export function standardFromFilename(name: string): AccountingStandard {
  // Strip extension and any trailing underscores (Capitaline often emits
  // names like `BalanceSheetINDAS_.xls`). Lowercase for stable matching.
  const base = name
    .toLowerCase()
    .replace(/\.[a-z]+$/, "")
    .replace(/_+$/, "");

  // INDAS is unambiguous and may appear anywhere in the basename.
  if (/indas/.test(base)) return "ind-as";

  // Revised Schedule VI: match "revised", "revsch", or "rev" at end of
  // basename (e.g. `BalanceSheetREV_.xls` → base `balancesheetrev`).
  // The end-anchor on `rev$` is enough — `revenue` ends in `e`, not `v`.
  if (/revised|revsch/.test(base) || /rev$/.test(base)) {
    return "revised-sch-vi";
  }

  // Standard / Old GAAP: "standard" or "gaap" anywhere, "std" at end of
  // basename. End-anchor on `std$` keeps middle-of-word bigrams from
  // matching.
  if (/standard|gaap/.test(base) || /std$/.test(base)) {
    return "standard";
  }

  // Cash flow files often have no suffix because the format barely
  // changed across standards. Default to "unknown" rather than guessing —
  // the parser merges across files so the BS/PL standard usually
  // determines the period's dominant standard anyway.
  return "unknown";
}

/**
 * Standard precedence for collision resolution.
 * Higher number wins when the same FY appears in multiple files.
 *
 * Rationale: Ind-AS data is more granular (fair value, OCI, lease
 * capitalization, expected credit loss). Revised Sch-VI is closer to
 * Ind-AS than Standard but lacks fair-value categorization. Standard /
 * Old GAAP is the noisiest. Unknown is the lowest because we couldn't
 * verify the standard from filename.
 */
export const STANDARD_PRECEDENCE: Record<AccountingStandard, number> = {
  "ind-as": 4,
  "revised-sch-vi": 3,
  standard: 2,
  unknown: 1,
};

/**
 * Confidence band for a period based on its dominant accounting standard.
 * Used by the rigor envelope to discount older-standard periods.
 */
export function confidenceForStandard(
  std: AccountingStandard
): "high" | "medium" | "low" {
  if (std === "ind-as") return "high";
  if (std === "revised-sch-vi") return "medium";
  return "low";
}

/**
 * Alias map: source label (REV / Standard) → Ind-AS canonical label.
 *
 * Each alias is direction-of-fit: when we see the source label in a
 * non-Ind-AS file, we ALSO emit the canonical label so existing
 * mappingSpec lookups find it. We DO NOT remove the source label —
 * traceability requires the original to remain.
 *
 * Conservative coverage. Labels added here must be unambiguous 1:1
 * mappings under both Indian standards. Labels with semantic shifts
 * across standards (e.g. lease classification under Ind AS 116) are
 * deliberately omitted.
 */
export interface StandardAlias {
  source: string;             // label as it appears in REV/Standard files
  canonical: string;          // Ind-AS canonical label
  appliesTo: AccountingStandard[];
  notes?: string;
}

export const STANDARD_ALIASES: StandardAlias[] = [
  // ── Equity ─────────────────────────────────────────────────────────
  { source: "Reserves and Surplus", canonical: "Other Equity",
    appliesTo: ["revised-sch-vi", "standard"],
    notes: "Old composite reserve heading; Ind-AS splits into Other Equity components." },
  { source: "Reserves & Surplus", canonical: "Other Equity",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Share Capital", canonical: "Equity Share Capital",
    appliesTo: ["revised-sch-vi", "standard"],
    notes: "Includes preference share capital under old GAAP — caller should verify breakdown." },

  // ── Assets ─────────────────────────────────────────────────────────
  { source: "Sundry Debtors", canonical: "Trade Receivables",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Total Sundry Debtors", canonical: "Total Trade Receivables",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Loans and Advances", canonical: "Total Long-term Loans and Advances",
    appliesTo: ["standard"],
    notes: "Old GAAP single bucket; Ind-AS splits long/short-term." },
  { source: "Investments", canonical: "Total Investments",
    appliesTo: ["standard"],
    notes: "Old GAAP single bucket without FVTPL/FVTOCI categorization." },
  { source: "Net Block", canonical: "Net Property, plant and equipment",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Gross Block", canonical: "Gross Property, plant and equipment",
    appliesTo: ["revised-sch-vi", "standard"] },

  // ── Liabilities ────────────────────────────────────────────────────
  { source: "Secured Loans", canonical: "Long Term Borrowings",
    appliesTo: ["standard"],
    notes: "Old GAAP merged secured/unsecured — caller should sum with Unsecured Loans." },
  { source: "Unsecured Loans", canonical: "Short Term Borrowings",
    appliesTo: ["standard"],
    notes: "Approximate; many unsecured loans were long-term." },
  { source: "Sundry Creditors", canonical: "Trade Payables",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Total Sundry Creditors", canonical: "Total Trade Payables",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Provisions", canonical: "Total Long-term Provisions",
    appliesTo: ["standard"],
    notes: "Old GAAP composite; Ind-AS splits long/short-term." },

  // ── P&L ────────────────────────────────────────────────────────────
  { source: "Sales", canonical: "Total Revenue",
    appliesTo: ["standard"],
    notes: "Old GAAP gross sales (incl excise) — recast may need to net out excise." },
  { source: "Net Sales", canonical: "Total Revenue",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Other Income", canonical: "Total Other Operating Revenue",
    appliesTo: ["revised-sch-vi", "standard"],
    notes: "Old GAAP often included financial income here — verify before treating as operating." },
  { source: "Total Income", canonical: "Total Revenue",
    appliesTo: ["revised-sch-vi"] },
  { source: "Raw Materials", canonical: "Total Raw Material Consumed",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Power and Fuel", canonical: "Power, Fuel and Water",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Employee Cost", canonical: "Total Employee Cost",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Selling and Administration Expenses", canonical: "Total Selling and Administrative Expenses",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Selling & Distribution Expenses", canonical: "Total Selling and Distribution Expenses",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Depreciation", canonical: "Total Depreciation and Amortization",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Interest", canonical: "Total Interest and Finance Charges",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Profit Before Tax", canonical: "Net Profit before Tax & Extraordinary Items",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Tax", canonical: "Total Tax",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Reported Net Profit", canonical: "Profit After Tax",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Earnings Per Share (Rs)", canonical: "Basic EPS",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Dividend (%)", canonical: "Equity Dividend Rate (%)",
    appliesTo: ["revised-sch-vi", "standard"] },

  // ── Cash Flow ─────────────────────────────────────────────────────
  // Most CF labels are identical across standards. Only listing entries
  // that genuinely rename. (Identity entries omitted — they would be
  // no-ops since the original label is always emitted anyway.)
  { source: "Net Cash from Investing Activities", canonical: "Net Cash Used in Investing Activities",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Net Cash from Financing Activities", canonical: "Net Cash Used in Financing Activities",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Capital Expenditure", canonical: "Purchase of Fixed Assets",
    appliesTo: ["revised-sch-vi", "standard"] },
  { source: "Dividends Paid", canonical: "Dividend Paid",
    appliesTo: ["revised-sch-vi", "standard"] },
];

/**
 * Build a fast lookup: source label → Ind-AS canonical label,
 * filtered to aliases that apply to the given source standard.
 *
 * Lookup is exact-match on normalized label. Callers should normalize
 * (trim + collapse whitespace) before lookup; the parser already does.
 */
export function buildAliasMap(
  sourceStandard: AccountingStandard
): Map<string, string> {
  const m = new Map<string, string>();
  if (sourceStandard === "ind-as") return m; // no aliases needed
  for (const a of STANDARD_ALIASES) {
    if (a.appliesTo.includes(sourceStandard)) {
      // Last-write-wins on duplicate sources is fine — entries are unique.
      m.set(a.source, a.canonical);
    }
  }
  return m;
}
