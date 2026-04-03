import { RawPeriodData } from "./types";
import { SourceParserDiagnostics } from "./parserDiagnostics";

const FACT_TO_CANONICAL: Record<string, string> = {
  // Income statement
  RevenueFromOperations: "Revenue From Operations(Net)",
  RevenueFromOperationsNet: "Revenue From Operations(Net)",
  Revenue: "Revenue From Operations(Net)",
  ProfitLoss: "Profit After Tax",
  ProfitAfterTax: "Profit After Tax",
  ProfitBeforeTax: "Profit Before Tax",
  TaxExpense: "Tax Expenses",
  FinanceCosts: "Finance Cost",
  OtherComprehensiveIncome: "Other Comprehensive Income no Specification",
  TotalComprehensiveIncome: "Total Comprehensive Income for the Year",
  // Balance sheet
  Assets: "Total Assets",
  Equity: "Total Equity",
  EquityAttributableToOwnersOfParent: "Total Stockholders' Equity",
  NoncontrollingInterests: "Minority Interest",
  CashAndCashEquivalents: "Cash and Cash Equivalents",
  CurrentInvestments: "Current Investments",
  NonCurrentInvestments: "Investments - Long-term",
  TradeReceivables: "Trade Receivables",
  Inventories: "Inventories",
  PropertyPlantAndEquipment: "Net Property, plant and equipment",
  // Cash flow
  NetCashFromOperatingActivities: "Net Cash from Operating Activities",
  PurchaseOfPropertyPlantAndEquipment: "Purchased of Fixed Assets",
  DividendsPaid: "Dividend Paid",
  ProceedsFromIssueOfShares: "Proceeds from Issue of shares (incl share premium)",
  InterestReceived: "Interest Received",
};

function parseDate(s: string): string | null {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function localName(tag: string): string {
  const i = tag.indexOf(":");
  return i >= 0 ? tag.slice(i + 1) : tag;
}

/**
 * Best-effort iXBRL / XBRL parser for MCA filings.
 * Extracts instant contexts and mapped facts into RawPeriodData format.
 */
export function parseXbrlXml(xmlText: string, companyId = "XBRL_CO"): RawPeriodData[] {
  return parseXbrlXmlDetailed(xmlText, companyId).periods;
}

export function parseXbrlXmlDetailed(xmlText: string, companyId = "XBRL_CO"): {
  periods: RawPeriodData[];
  diagnostics: SourceParserDiagnostics;
} {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("Invalid XBRL XML document.");

  const contextById: Record<string, string> = {};
  const contexts = Array.from(doc.getElementsByTagNameNS("*", "context"));
  let unresolvedContexts = 0;
  for (const ctx of contexts) {
    const id = ctx.getAttribute("id") || "";
    const instant = ctx.getElementsByTagNameNS("*", "instant")[0]?.textContent?.trim();
    const endDate = ctx.getElementsByTagNameNS("*", "endDate")[0]?.textContent?.trim();
    const period = parseDate(instant || endDate || "");
    if (id && period) contextById[id] = period;
    else if (id) unresolvedContexts += 1;
  }

  const rows: Record<string, RawPeriodData> = {};
  const all = Array.from(doc.getElementsByTagName("*") as unknown as Element[]);
  let mappedFactCount = 0;
  let numericParseErrors = 0;
  let duplicateFactConflicts = 0;

  for (const el of all) {
    const ctxRef = el.getAttribute("contextRef");
    if (!ctxRef || !contextById[ctxRef]) continue;
    const period = contextById[ctxRef];
    const key = localName(el.tagName);
    const mapped = FACT_TO_CANONICAL[key] || FACT_TO_CANONICAL[key.replace(/\s+/g, "")];
    if (!mapped) continue;

    const raw = el.textContent?.replace(/,/g, "").trim() || "";
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      numericParseErrors += 1;
      continue;
    }

    if (!rows[period]) {
      rows[period] = { company_id: companyId, period_end: period, raw_metric_values: {} };
    }
    const existing = rows[period].raw_metric_values[mapped];
    if (typeof existing === "number" && Number.isFinite(existing) && existing !== value) {
      duplicateFactConflicts += 1;
    }
    rows[period].raw_metric_values[mapped] = value;
    mappedFactCount += 1;
  }

  const periods = Object.values(rows).sort((a, b) => a.period_end.localeCompare(b.period_end));
  return {
    periods,
    diagnostics: {
      sourceMode: "xbrl",
      warningCount: [unresolvedContexts > 0, duplicateFactConflicts > 0].filter(Boolean).length,
      errorCount: [contexts.length === 0, mappedFactCount === 0, numericParseErrors > 0].filter(Boolean).length,
      checks: [
        {
          id: "xbrl-contexts-present",
          label: "XBRL contexts present",
          passed: contexts.length > 0,
          detail: contexts.length > 0
            ? `Found ${contexts.length} XBRL contexts.`
            : "No XBRL contexts were found in the uploaded XML.",
        },
        {
          id: "xbrl-context-periods",
          label: "Context periods resolved",
          passed: contexts.length > 0 && unresolvedContexts === 0,
          detail: contexts.length > 0
            ? `Resolved periods for ${contexts.length - unresolvedContexts}/${contexts.length} XBRL contexts.`
            : "No contexts were available to resolve to periods.",
        },
        {
          id: "xbrl-mapped-facts",
          label: "Mapped canonical facts",
          passed: mappedFactCount >= 4,
          detail: `Mapped ${mappedFactCount} canonical facts from XBRL contexts.`,
        },
        {
          id: "xbrl-numeric-facts",
          label: "Numeric facts parsed",
          passed: numericParseErrors === 0,
          detail: numericParseErrors === 0
            ? "Every mapped XBRL fact parsed as a finite number."
            : `${numericParseErrors} mapped XBRL facts could not be parsed as finite numbers.`,
        },
        {
          id: "xbrl-duplicate-conflicts",
          label: "Conflicting duplicate facts",
          passed: duplicateFactConflicts === 0,
          detail: duplicateFactConflicts === 0
            ? "No conflicting duplicate XBRL facts were detected for the same period and concept."
            : `${duplicateFactConflicts} conflicting duplicate XBRL facts were detected for the same period and concept.`,
        },
      ],
    },
  };
}
