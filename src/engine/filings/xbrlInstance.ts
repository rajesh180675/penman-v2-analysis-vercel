/**
 * Indian listed-company XBRL (BSE `in-bse-fin` Ind AS taxonomy, as filed on
 * NSE/BSE) — instance parsing and full-year extraction.
 *
 * Dependency-free and string-based so it runs identically in the browser and
 * in Node scripts (Node has no DOMParser).
 *
 * THE CONTEXT-DATE TRAP. In results filings produced by the exchanges' Excel
 * utility, context IDs follow a fixed convention — One* = current quarter,
 * Four* = current year-to-date — but the YTD context is frequently stamped
 * with the QUARTER's dates. ITC's FY24 filing dates both `OneD` and `FourD`
 * 2024-01-01..2024-03-31, while `FourD` holds the full-year revenue
 * (₹76,840 Cr vs the quarter's ₹19,446 Cr). Selecting by dates alone returns
 * the quarter as the year. So the ID convention is authoritative when present,
 * and genuine 12-month date spans are the fallback.
 */

export interface XbrlContext {
  readonly id: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly instant: string | null;
  /** Carries a segment/scenario dimension (segment, expense breakdown …). */
  readonly dimensional: boolean;
}

export interface XbrlFact {
  readonly prefix: string;
  readonly concept: string;
  readonly contextRef: string;
  readonly unitRef: string | null;
  readonly decimals: string | null;
  readonly value: number | null;
  readonly text: string;
}

export interface XbrlInstance {
  readonly contexts: ReadonlyMap<string, XbrlContext>;
  readonly facts: readonly XbrlFact[];
}

const STRUCTURAL_PREFIXES = new Set(["xbrli", "link", "xlink", "xbrldi", "iso4217", "xsi"]);

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagValue(body: string, tag: string): string | null {
  const match = new RegExp(`<(?:[A-Za-z0-9-]+:)?${tag}>\\s*([^<]+?)\\s*</(?:[A-Za-z0-9-]+:)?${tag}>`).exec(body);
  return match ? match[1]! : null;
}

export function parseXbrlInstance(xml: string): XbrlInstance {
  const contexts = new Map<string, XbrlContext>();
  const contextPattern = /<(?:[A-Za-z0-9-]+:)?context\s+id="([^"]+)"\s*>([\s\S]*?)<\/(?:[A-Za-z0-9-]+:)?context>/g;
  for (let m = contextPattern.exec(xml); m; m = contextPattern.exec(xml)) {
    const body = m[2]!;
    contexts.set(m[1]!, {
      id: m[1]!,
      startDate: tagValue(body, "startDate"),
      endDate: tagValue(body, "endDate"),
      instant: tagValue(body, "instant"),
      dimensional: /explicitMember|typedMember|<(?:[A-Za-z0-9-]+:)?segment[\s>]|<(?:[A-Za-z0-9-]+:)?scenario[\s>]/.test(body),
    });
  }

  const facts: XbrlFact[] = [];
  const factPattern = /<([A-Za-z0-9-]+):([A-Za-z0-9_]+)\s+([^>]*?contextRef="[^"]+"[^>]*?)(?:\/>|>([\s\S]*?)<\/\1:\2>)/g;
  for (let m = factPattern.exec(xml); m; m = factPattern.exec(xml)) {
    const [, prefix, concept, attributes, rawText = ""] = m;
    if (STRUCTURAL_PREFIXES.has(prefix!)) continue;
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(attributes!)?.[1] ?? null;
    const text = decodeEntities(rawText.trim());
    const numeric = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text) ? Number(text) : null;
    facts.push({
      prefix: prefix!,
      concept: concept!,
      contextRef: attr("contextRef")!,
      unitRef: attr("unitRef"),
      decimals: attr("decimals"),
      value: numeric,
      text,
    });
  }
  return { contexts, facts };
}

const DAY_MS = 86_400_000;
const days = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / DAY_MS;

/**
 * The non-dimensional contexts that carry the CURRENT fiscal year:
 * the year-to-date duration and the closing balance-sheet instant.
 */
export type AnnualContextMethod = "id-convention" | "id-convention-undeclared" | "date-span" | "none";

/**
 * The non-dimensional contexts that carry the CURRENT fiscal year:
 * the year-to-date duration and the closing balance-sheet instant.
 *
 * Older utility output (ITC FY18–FY22) references `FourD`/`OneI` in facts
 * without ever declaring those contexts — invalid XBRL, but consistent. When
 * the fiscal-year end is known independently (the exchange listing states
 * it), an undeclared convention context is read as that period and labelled
 * `id-convention-undeclared` so the weaker provenance stays visible.
 */
export function selectAnnualContexts(instance: XbrlInstance, fiscalYearEnd: string): {
  duration: XbrlContext | null;
  instant: XbrlContext | null;
  method: AnnualContextMethod;
} {
  const plain = [...instance.contexts.values()].filter((c) => !c.dimensional);
  const referenced = new Set(instance.facts.map((f) => f.contextRef));
  const undeclared = (id: string) => referenced.has(id) && !instance.contexts.has(id);
  const instant = plain.find((c) => c.instant === fiscalYearEnd && /^One/i.test(c.id))
    ?? plain.find((c) => c.instant === fiscalYearEnd)
    ?? (undeclared("OneI") ? { id: "OneI", startDate: null, endDate: null, instant: fiscalYearEnd, dimensional: false } : null);
  // Authoritative: the utility's YTD context ID, whatever dates it carries.
  const byId = plain.find((c) => /^FourD$/i.test(c.id) && c.endDate === fiscalYearEnd);
  if (byId) return { duration: byId, instant, method: "id-convention" };
  const bySpan = plain.find((c) => c.startDate && c.endDate === fiscalYearEnd && days(c.startDate, c.endDate) >= 330 && days(c.startDate, c.endDate) <= 400);
  if (bySpan) return { duration: bySpan, instant, method: "date-span" };
  if (undeclared("FourD")) {
    return {
      duration: { id: "FourD", startDate: null, endDate: fiscalYearEnd, instant: null, dimensional: false },
      instant,
      method: "id-convention-undeclared",
    };
  }
  return { duration: null, instant, method: "none" };
}

/** Headline full-year figures in ₹ crore, keyed by taxonomy concept. */
export const ANNUAL_HEADLINE_CONCEPTS = {
  revenue: "RevenueFromOperations",
  profitBeforeTax: "ProfitBeforeTax",
  profitAfterTax: "ProfitLossForPeriod",
  profitFromContinuingOperations: "ProfitLossForPeriodFromContinuingOperations",
  profitFromDiscontinuedOperations: "ProfitLossFromDiscontinuedOperationsAfterTax",
  profitAttributableToOwners: "ProfitOrLossAttributableToOwnersOfParent",
  financeCosts: "FinanceCosts",
  totalAssets: "Assets",
  totalEquity: "Equity",
  equityAttributableToOwners: "EquityAttributableToOwnersOfParent",
  cashFlowFromOperations: "CashFlowsFromUsedInOperatingActivities",
} as const;

export type AnnualHeadline = { -readonly [K in keyof typeof ANNUAL_HEADLINE_CONCEPTS]: number | null };

const INSTANT_FIELDS = new Set<keyof AnnualHeadline>(["totalAssets", "totalEquity", "equityAttributableToOwners"]);
const RUPEES_PER_CRORE = 1e7;

export function extractAnnualHeadline(instance: XbrlInstance, fiscalYearEnd: string): {
  headline: AnnualHeadline;
  method: AnnualContextMethod;
} {
  const { duration, instant, method } = selectAnnualContexts(instance, fiscalYearEnd);
  const headline = {} as AnnualHeadline;
  for (const [field, concept] of Object.entries(ANNUAL_HEADLINE_CONCEPTS) as [keyof AnnualHeadline, string][]) {
    const context = INSTANT_FIELDS.has(field) ? instant : duration;
    const fact = context
      ? instance.facts.find((f) => f.concept === concept && f.contextRef === context.id && f.value != null && f.unitRef?.toUpperCase() === "INR")
      : undefined;
    headline[field] = fact?.value != null ? fact.value / RUPEES_PER_CRORE : null;
  }
  return { headline, method };
}

/**
 * A lender's closing balance sheet in the Division III (NBFC) format, ₹ crore.
 * Totals are read rather than assets and equity because the FY20–FY22 utility
 * output tags no `Assets` or `Equity`, and no cash line, while every year
 * tags the financial and non-financial subtotals.
 */
export interface LenderBalanceSheet {
  readonly financialAssets: number;
  readonly nonFinancialAssets: number;
  readonly loans: number;
  /** Trade and other receivables: operating claims inside financial assets. */
  readonly receivables: number;
  readonly financialLiabilities: number;
  readonly nonFinancialLiabilities: number;
  /** Trade and other payables: operating obligations inside financial liabilities. */
  readonly payables: number;
  /** Share capital plus other equity: the owners' part of equity, or null where not tagged. */
  readonly ownersEquity: number | null;
}

const PAYABLES_CONCEPTS = [
  "TotalOutstandingDuesOfMicroEnterpriseAndSmallEnterprise",
  "TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterprise",
  "TotalOutstandingDuesOfMicroEnterpriseAndSmallEnterpriseOtherPayables",
  "TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterpriseOtherPayables",
] as const;

/**
 * The Division III subtotals, or null when the filing is not in that format.
 * `FinanicalAssets` is the taxonomy's own spelling, used by every NBFC filing
 * from FY20 to the FY25 integrated filings; the correct spelling is accepted
 * too in case a later taxonomy fixes it.
 */
export function extractLenderBalanceSheet(instance: XbrlInstance, fiscalYearEnd: string): LenderBalanceSheet | null {
  const { instant } = selectAnnualContexts(instance, fiscalYearEnd);
  if (!instant) return null;
  const read = (concepts: readonly string[]): number | null => {
    const values = concepts.map((concept) => instance.facts.find((f) =>
      f.concept === concept && f.contextRef === instant.id && f.value != null && f.unitRef?.toUpperCase() === "INR")?.value ?? null);
    return values.some((value) => value != null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / RUPEES_PER_CRORE : null;
  };
  const financialAssets = read(["FinanicalAssets"]) ?? read(["FinancialAssets"]);
  const nonFinancialAssets = read(["NonFinancialAssets"]);
  const financialLiabilities = read(["FinancialLiabilities"]);
  const nonFinancialLiabilities = read(["NonFinancialLiabilities"]);
  if (financialAssets == null || nonFinancialAssets == null || financialLiabilities == null || nonFinancialLiabilities == null) return null;
  return {
    financialAssets,
    nonFinancialAssets,
    loans: read(["Loans"]) ?? 0,
    receivables: read(["TradeReceivables", "OtherReceivables"]) ?? 0,
    financialLiabilities,
    nonFinancialLiabilities,
    payables: read(PAYABLES_CONCEPTS) ?? 0,
    // ABCL's FY24 filing tags share capital and other equity but no
    // non-controlling interest, so the owners' part is read, not the NCI.
    ownersEquity: read(["EquityAttributableToOwnersOfParent"])
      ?? (read(["EquityShareCapital"]) != null && read(["OtherEquity"]) != null ? read(["EquityShareCapital", "OtherEquity"]) : null),
  };
}
