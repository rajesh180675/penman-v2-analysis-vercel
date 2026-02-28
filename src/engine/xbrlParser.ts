import { RawPeriodData } from "./types";

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
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("Invalid XBRL XML document.");

  const contextById: Record<string, string> = {};
  const contexts = Array.from(doc.getElementsByTagNameNS("*", "context"));
  for (const ctx of contexts) {
    const id = ctx.getAttribute("id") || "";
    const instant = ctx.getElementsByTagNameNS("*", "instant")[0]?.textContent?.trim();
    const endDate = ctx.getElementsByTagNameNS("*", "endDate")[0]?.textContent?.trim();
    const period = parseDate(instant || endDate || "");
    if (id && period) contextById[id] = period;
  }

  const rows: Record<string, RawPeriodData> = {};
  const all = Array.from(doc.getElementsByTagName("*") as unknown as Element[]);

  for (const el of all) {
    const ctxRef = el.getAttribute("contextRef");
    if (!ctxRef || !contextById[ctxRef]) continue;
    const period = contextById[ctxRef];
    const key = localName(el.tagName);
    const mapped = FACT_TO_CANONICAL[key] || FACT_TO_CANONICAL[key.replace(/\s+/g, "")];
    if (!mapped) continue;

    const raw = el.textContent?.replace(/,/g, "").trim() || "";
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;

    if (!rows[period]) {
      rows[period] = { company_id: companyId, period_end: period, raw_metric_values: {} };
    }
    rows[period].raw_metric_values[mapped] = value;
  }

  return Object.values(rows).sort((a, b) => a.period_end.localeCompare(b.period_end));
}
