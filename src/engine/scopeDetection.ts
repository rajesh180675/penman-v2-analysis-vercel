/**
 * Scope Detection — Consolidated vs Standalone
 *
 * Extracts reporting scope from Capitaline HTML file headers.
 * Header format: "Finance >>Balance Sheet IND (Consolidated)>>ITC Ltd(Curr. in )"
 */

export type ReportingScope = "consolidated" | "standalone" | "unknown";

/**
 * Confidence level for the scope detection. Reviewers can use this to gate
 * downstream decisions: header-match is reliable; fallback-keyword is a guess
 * (review S5).
 */
export type ScopeConfidence = "header-match" | "fallback-keyword" | "unknown";

export interface ScopeMetadata {
  scope: ReportingScope;
  companyName: string | null;
  statementType: string | null; // "Balance Sheet", "Profit Loss", "Cash Flow", "Segment Finance"
  confidence: ScopeConfidence;
}

/**
 * Search only the head of the document (first 4 KB) so disclaimers/footnotes
 * lower in the file ("the consolidated entity ...") don't false-positive the
 * fallback keyword scan (review W2).
 */
function searchHead(html: string, pattern: RegExp, headBytes = 4096): boolean {
  return pattern.test(html.slice(0, headBytes));
}

/**
 * Detect reporting scope from Capitaline HTML content.
 *
 * Strategy:
 *   1. Match the structured Capitaline header (handles `>` and `&gt;` and `&#62;`
 *      entity variants) — this is the only reliable signal. confidence = "header-match".
 *   2. Fall back to keyword search restricted to the first 4 KB of HTML
 *      (header region only — review W2). confidence = "fallback-keyword".
 *   3. If neither succeeds, return "unknown".
 */
export function detectReportingScope(html: string): ScopeMetadata {
  // Try to extract from the structured header:
  // "Finance >>Balance Sheet IND (Consolidated)>>Company Name(Curr. in )"
  // Accept all three Capitaline angle-bracket variants: >, &gt;, &#62; (review W3).
  const angle = "(?:&gt;|&#62;|>)";
  const headerMatch = html.match(
    new RegExp(`Finance\\s*${angle}{2}\\s*([^(>]+)\\s*\\(([^)]+)\\)\\s*${angle}{2}\\s*([^(<]+)`),
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

    return {
      scope,
      companyName,
      statementType,
      confidence: scope === "unknown" ? "unknown" : "header-match",
    };
  }

  // Fallback: keyword search restricted to the document head so "consolidated"
  // appearing in a disclaimer paragraph doesn't drive the scope (review W2).
  const hasConsolidated = searchHead(html, /\bConsolidated\b/i);
  const hasStandalone   = searchHead(html, /\bStandalone\b/i);

  const scope: ReportingScope = hasConsolidated && !hasStandalone
    ? "consolidated"
    : hasStandalone && !hasConsolidated
      ? "standalone"
      : "unknown";

  // Try to extract company name from any header-like pattern (also restricted
  // to the document head for the same reason).
  const headSlice = html.slice(0, 4096);
  const companyMatch = headSlice.match(/(?:&gt;|&#62;|>){2}\s*([A-Z][^(<]{2,40}?)(?:\(|<)/);
  const companyName = companyMatch ? companyMatch[1].trim() : null;

  return {
    scope,
    companyName,
    statementType: null,
    confidence: scope === "unknown" ? "unknown" : "fallback-keyword",
  };
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
