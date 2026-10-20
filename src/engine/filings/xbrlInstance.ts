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

export type AnnualHeadline = { -readonly [K in keyof typeof ANNUAL_HEADLINE_CONCEPTS]: number | null } & {
  /**
   * Excise duty for the year, where the filing itemizes it among other
   * expenses ("Excise Duty"): revenue from operations is gross of it.
   * Null when not itemized. Absent on records extracted before it was read.
   */
  exciseDuty?: number | null;
  /**
   * The minority's share of the year's profit and of closing equity, where
   * filed: with them, owners' + minority = total is an identity a filing can
   * be checked against (tieOut.ts headlineInconsistencies). Absent on records
   * extracted before they were read.
   */
  profitAttributableToNonControllingInterests?: number | null;
  nonControllingInterest?: number | null;
  /**
   * Equity shares in issue, in crore: paid-up equity capital over face value,
   * or profit over EPS where no face value is filed (sharesInIssue). A bonus or split after the period a valuation is drawn from changes it,
   * and the price with it (HDFC Bank: 765.22 crore filed for FY2025, 1,539.34
   * for FY2026). Absent on records extracted before it was read.
   */
  sharesOutstandingCr?: number | null;
  /**
   * Total expenses (finance costs included), the tax charge, and a rate-
   * regulated entity's net movement in regulatory deferral balances, which is
   * filed below profit before tax (NTPC and Power Grid, every year): what a
   * core operating income is built from (filedCoreIncome.ts). Absent on records
   * extracted before they were read.
   */
  expenses?: number | null;
  taxExpense?: number | null;
  regulatoryDeferralMovement?: number | null;
};

const INSTANT_FIELDS = new Set<keyof AnnualHeadline>(["totalAssets", "totalEquity", "equityAttributableToOwners"]);
const RUPEES_PER_CRORE = 1e7;

/** The year's figures, or another period's where its contexts are given (a quarter's year to date). */
export function extractAnnualHeadline(
  instance: XbrlInstance,
  fiscalYearEnd: string,
  contexts: ReturnType<typeof selectAnnualContexts> = selectAnnualContexts(instance, fiscalYearEnd),
): {
  headline: AnnualHeadline;
  method: AnnualContextMethod;
} {
  const { duration, instant, method } = contexts;
  const headline = {} as AnnualHeadline;
  for (const [field, concept] of Object.entries(ANNUAL_HEADLINE_CONCEPTS) as [keyof AnnualHeadline, string][]) {
    const context = INSTANT_FIELDS.has(field) ? instant : duration;
    const fact = context
      ? instance.facts.find((f) => f.concept === concept && f.contextRef === context.id && f.value != null && f.unitRef?.toUpperCase() === "INR")
      : undefined;
    headline[field] = fact?.value != null ? fact.value / RUPEES_PER_CRORE : null;
  }
  headline.exciseDuty = duration ? itemizedExcise(instance, duration, method) : null;
  const read = (concept: string, context: XbrlContext | null): number | null => {
    const fact = context
      ? instance.facts.find((f) => f.concept === concept && f.contextRef === context.id && f.value != null && f.unitRef?.toUpperCase() === "INR")
      : undefined;
    return fact?.value != null ? fact.value / RUPEES_PER_CRORE : null;
  };
  headline.profitAttributableToNonControllingInterests = read("ProfitOrLossAttributableToNonControllingInterests", duration);
  headline.nonControllingInterest = read("NonControllingInterest", instant);
  headline.sharesOutstandingCr = sharesInIssue(instance, duration, instant);
  headline.expenses = read("Expenses", duration);
  headline.taxExpense = read("TaxExpense", duration);
  headline.regulatoryDeferralMovement = read("NetMovementInRegulatoryDeferralAccountBalancesRelatedToProfitOrLossAndTheRelatedDeferredTaxMovement", duration);
  return { headline, method };
}

/**
 * The year's profit and the basic EPS struck on it, by filing format: Ind AS
 * (owners' profit where consolidated), banks, life insurers.
 */
const EPS_BASES = [
  ["ProfitOrLossAttributableToOwnersOfParent", "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations"],
  ["ProfitLossForPeriod", "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations"],
  ["ProfitLossForThePeriod", "BasicEarningsPerShareAfterExtraordinaryItems"],
  ["ProfitLossAfterTaxAndExtraordinaryItems", "BasicAndDilutedEPSAfterExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized"],
] as const;

/**
 * Paid-up equity capital over face value, in crore shares. Results filings tag
 * both in the period's duration contexts (`FourD`), some in the instant; the
 * face value carries its own unit (INRPerShare).
 *
 * The year's profit over its basic EPS is the weighted-average count, to EPS's
 * two decimals. Across the 261 records on file (data/filings) that carry both,
 * the two agree within 2% in 225; the widest gap with the capital tags right
 * is 2× (Maruti FY2024, its EPS filed at twice its profit per share). Where
 * they part by more than 3×, a tag is wrong and the filing gives no count:
 * HUL FY2018 filed its face value as 216, ICICI Bank FY2023 its paid-up
 * capital as ₹2 Cr, Sun Pharma FY2025 its face value as 719,780.9.
 *
 * A life insurer's filing tags paid-up capital (`PaidUpEquityShareCapital`)
 * but no face value, so its count is the EPS one: HDFC Life FY2026 215.84
 * crore against 215.78 in issue (₹2,157.82 Cr at ₹10), LIC 632.47 against
 * 632.50.
 */
function sharesInIssue(instance: XbrlInstance, duration: XbrlContext | null, instant: XbrlContext | null): number | null {
  const value = (concept: string, unit: string): number | null => {
    for (const context of [duration, instant]) {
      const fact = context
        ? instance.facts.find((f) => f.concept === concept && f.contextRef === context.id && f.value != null && f.unitRef?.toUpperCase() === unit)
        : undefined;
      if (fact?.value != null) return fact.value;
    }
    return null;
  };
  const paidUp = value("PaidUpValueOfEquityShareCapital", "INR");
  const face = value("FaceValueOfEquityShareCapital", "INRPERSHARE");
  const byFaceValue = paidUp != null && paidUp > 0 && face != null && face > 0 ? paidUp / face / 1e7 : null;
  let byEps: number | null = null;
  for (const [profitConcept, epsConcept] of EPS_BASES) {
    const profit = value(profitConcept, "INR");
    const eps = value(epsConcept, "INRPERSHARE");
    if (profit != null && eps != null && eps !== 0) {
      byEps = profit / eps > 0 ? profit / eps / 1e7 : null;
      break;
    }
  }
  if (byFaceValue == null || byEps == null) return byFaceValue ?? byEps;
  return Math.max(byFaceValue / byEps, byEps / byFaceValue) <= 3 ? byFaceValue : null;
}

/**
 * The year's excise duty, where the filing itemizes it among other expenses:
 * each item is an `OtherExpenses` fact in its own context, labelled by a
 * `DescriptionOfOtherExpenses` fact in the same context (ITC FY18: "Excise
 * Duty" ₹4,239.61 Cr; Asian Paints FY18: "Excise" ₹437.68 Cr). Revenue from
 * operations is gross of it, which Capitaline's net revenue is not.
 *
 * A year's item contexts are named after its YTD context (`FourD` →
 * `FourOperatingExpenses01D`); the ID is authoritative there, because the
 * utility stamps those contexts with the quarter's dates, which the quarter's
 * own items (`OneOperatingExpenses01D`) share. Otherwise an item context
 * belongs to the year when its dates are the year's.
 */
function itemizedExcise(instance: XbrlInstance, duration: XbrlContext, method: AnnualContextMethod): number | null {
  const inYear = (contextRef: string): boolean => {
    if (/^FourD$/i.test(duration.id) && method !== "date-span") return /^Four.+D$/i.test(contextRef);
    const context = instance.contexts.get(contextRef);
    return context != null && context.startDate === duration.startDate && context.endDate === duration.endDate;
  };
  const exciseContexts = new Set(instance.facts
    .filter((f) => f.concept === "DescriptionOfOtherExpenses" && /excise/i.test(f.text) && inYear(f.contextRef))
    .map((f) => f.contextRef));
  if (exciseContexts.size === 0) return null;
  let total = 0;
  for (const fact of instance.facts) {
    if (fact.concept === "OtherExpenses" && exciseContexts.has(fact.contextRef) && fact.value != null) total += fact.value;
  }
  return total / RUPEES_PER_CRORE;
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

/**
 * An industrial (Division II) filing's figures for operating profitability,
 * ₹ crore: the year's income-statement totals and the closing balance sheet's
 * financial lines, each summed over its current and non-current parts.
 *
 * Results filings carry a balance sheet only from FY2023 (the statement of
 * assets and liabilities in the 2020-03-31 taxonomy): before that every
 * balance-sheet field is null, and `assets` is the field that says whether a
 * balance sheet was filed. Within a filed balance sheet a line left untagged
 * (a company without borrowings) is null as well.
 */
export interface OperatingFigures {
  readonly revenue: number | null;
  /** Total expenses, finance costs included. */
  readonly expenses: number | null;
  readonly financeCosts: number | null;
  readonly profitBeforeTax: number | null;
  readonly taxExpense: number | null;
  readonly assets: number | null;
  /** Total equity, the minority's share included. */
  readonly equity: number | null;
  readonly borrowings: number | null;
  /** Cash and cash equivalents plus other bank balances. */
  readonly cash: number | null;
  /** Current plus non-current investments. */
  readonly investments: number | null;
  /** Loans given, current plus non-current. */
  readonly loans: number | null;
}

export function extractOperatingFigures(instance: XbrlInstance, fiscalYearEnd: string): OperatingFigures {
  const { duration, instant } = selectAnnualContexts(instance, fiscalYearEnd);
  const read = (context: XbrlContext | null, concepts: readonly string[]): number | null => {
    if (!context) return null;
    const values = concepts.map((concept) => instance.facts.find((f) =>
      f.concept === concept && f.contextRef === context.id && f.value != null && f.unitRef?.toUpperCase() === "INR")?.value ?? null);
    return values.some((value) => value != null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / RUPEES_PER_CRORE : null;
  };
  return {
    revenue: read(duration, ["RevenueFromOperations"]),
    expenses: read(duration, ["Expenses"]),
    financeCosts: read(duration, ["FinanceCosts"]),
    profitBeforeTax: read(duration, ["ProfitBeforeTax"]),
    taxExpense: read(duration, ["TaxExpense"]),
    assets: read(instant, ["Assets"]),
    equity: read(instant, ["Equity"]),
    borrowings: read(instant, ["BorrowingsCurrent", "BorrowingsNoncurrent"]),
    cash: read(instant, ["CashAndCashEquivalents", "BankBalanceOtherThanCashAndCashEquivalents"]),
    investments: read(instant, ["CurrentInvestments", "NoncurrentInvestments"]),
    loans: read(instant, ["LoansCurrent", "LoansNoncurrent"]),
  };
}
