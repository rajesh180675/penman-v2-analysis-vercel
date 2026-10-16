import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { processCompanyDataFull } from "../../../engine/pipeline";
import { DEFAULT_CONFIG } from "../../../engine/types";
import { RecastVerificationPanel } from "../RecastVerificationPanel";

describe("RecastVerificationPanel", () => {
  it("renders a year with no filed tax rate", () => {
    // DMart FY15-shaped: a balance sheet and no P&L, so the year has no filed
    // tax rate (null). Formatting it as a number crashed the classic app.
    const [period] = processCompanyDataFull([{
      company_id: "NO-PL",
      period_end: "2015-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 1000,
        "Total Stockholders' Equity__BalanceSheet": 600,
        "Total Equity__BalanceSheet": 600,
        "Minority Interest__BalanceSheet": 0,
        "Trade Payables__BalanceSheet": 400,
      },
    }], { ...DEFAULT_CONFIG, company_type: "consumer" }).periods;
    expect(period!.is.filedTaxRate).toBeNull();
    const html = renderToStaticMarkup(
      <RecastVerificationPanel recastPeriods={[period!]} verifyPeriod={period!} selectedPeriodIdx={0} setSelectedPeriodIdx={() => {}} />,
    );
    expect(html).toContain("filedTaxRate");
  });
});
