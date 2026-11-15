/**
 * Bajaj, Muthoot and Shriram Finance's condensed consolidated exports file no
 * interest-income line, so their NII is revenue from operations less finance
 * cost: the "NIM" and the yield behind the "Spread" include fee income
 * (Bajaj FY24: 12.75% against a published NIM near 10%). NbfcMetricsSection
 * said so; the profitability chart and the earning-power view labelled the
 * same series plainly.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BankHealthChart from "../charts/BankHealthChart";
import EarningPower from "../business-model/financial/EarningPower";
import type { BankPeriodMetrics } from "../../engine/bankPipeline";
import type { FinancialInstitutionAnalysisResult } from "../../engine/analysisFamily";

const metric = (period: string, basis: BankPeriodMetrics["interestIncomeBasis"]) => ({
  period_end: period,
  totalAssets: 400000,
  totalEquity: 90000,
  nim: 0.1275,
  spread: 0.115,
  roa: 0.04,
  roe: 0.19,
  creditCost: 0.02,
  costToIncome: 0.33,
  interestIncomeBasis: basis,
}) as unknown as BankPeriodMetrics;

const years = (basis: BankPeriodMetrics["interestIncomeBasis"]) => [metric("2024-03-31", basis), metric("2025-03-31", basis)];
const result = (subtype: "bank" | "nbfc", basis: BankPeriodMetrics["interestIncomeBasis"]) =>
  ({ subtype, bankMetrics: years(basis) }) as unknown as FinancialInstitutionAnalysisResult;

describe("a margin computed on revenue says so", () => {
  it("marks the profitability chart's NIM and counts the years (revenue basis)", () => {
    const html = renderToStaticMarkup(<BankHealthChart metrics={years("revenue-total")} ke={null} />);
    expect(html).toContain("NIM*");
    expect(html).toContain("In 2 of 2 years the export files no interest-income line");
  });

  it("leaves an interest-line NIM unmarked", () => {
    const html = renderToStaticMarkup(<BankHealthChart metrics={years("interest-line")} ke={null} />);
    expect(html).not.toContain("NIM*");
    expect(html).not.toContain("no interest-income line");
  });

  it("marks an NBFC's spread in the earning-power view (revenue basis)", () => {
    const html = renderToStaticMarkup(<EarningPower bankResult={result("nbfc", "revenue-total")} />);
    expect(html).toContain("Spread*");
    expect(html).toContain("on revenue, fees included");
    expect(html).toContain("the yield behind the spread is revenue from operations");
  });

  it("leaves a bank's interest-line NIM unmarked in the earning-power view", () => {
    const html = renderToStaticMarkup(<EarningPower bankResult={result("bank", "interest-line")} />);
    expect(html).not.toContain("NIM*");
    expect(html).toContain("net spread on assets");
  });
});
