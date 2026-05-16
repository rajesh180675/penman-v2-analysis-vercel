/**
 * Scope Detection — Consolidated vs Standalone
 *
 * Extracts reporting scope from Capitaline HTML file headers.
 * Header format: "Finance >>Balance Sheet IND (Consolidated)>>ITC Ltd(Curr. in )"
 */

export type ReportingScope = "consolidated" | "standalone" | "unknown";

export interface ScopeMetadata {
  scope: ReportingScope;
  companyName: string | null;
  statementType: string | null; // "Balance Sheet", "Profit Loss", "Cash Flow", "Segment Finance"
}

/**
 * Detect reporting scope from Capitaline HTML content.
 * Searches for "Consolidated" or "Standalone" keywords in the header.
 */
export function detectReportingScope(html: string): ScopeMetadata {
  // Try to extract from the structured header:
  // "Finance >>Balance Sheet IND (Consolidated)>>Company Name(Curr. in )"
  const headerMatch = html.match(
    /Finance\s*(?:&gt;|>){2}\s*([^(>]+)\s*\(([^)]+)\)\s*(?:&gt;|>){2}\s*([^(<]+)/
  );

  if (headerMatch) {
    const statementType = headerMatch[1].trim();
    const scopeStr = headerMatch[2].trim().toLowerCase();
    const companyName = headerMatch[3].trim().replace(/\(Curr\..*$/, "").trim();

    const scope: ReportingScope = scopeStr.includes("consolidated")
      ? "consolidated"
      : scopeStr.includes("standalone")
        ? "standalone"
        : "unknown";

    return { scope, companyName, statementType };
  }

  // Fallback: search for keywords anywhere in the document
  const hasConsolidated = /\bConsolidated\b/i.test(html);
  const hasStandalone = /\bStandalone\b/i.test(html);

  const scope: ReportingScope = hasConsolidated && !hasStandalone
    ? "consolidated"
    : hasStandalone && !hasConsolidated
      ? "standalone"
      : "unknown";

  // Try to extract company name from any header-like pattern
  const companyMatch = html.match(/(?:&gt;|>){2}\s*([A-Z][^(<]{2,40}?)(?:\(|<)/);
  const companyName = companyMatch ? companyMatch[1].trim() : null;

  return { scope, companyName, statementType: null };
}

/**
 * Detect scope from multiple files (e.g., a folder of BS + PL + CF).
 * Returns the consensus scope — if all files agree, returns that scope.
 */
export function detectFolderScope(htmlFiles: string[]): ReportingScope {
  const scopes = htmlFiles.map(html => detectReportingScope(html).scope);
  const unique = new Set(scopes.filter(s => s !== "unknown"));

  if (unique.size === 1) return unique.values().next().value!;
  if (unique.size === 0) return "unknown";
  // Mixed — shouldn't happen in a properly organized folder
  return "unknown";
}
