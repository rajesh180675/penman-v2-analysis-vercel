import { describe, expect, it } from "vitest";
import { extractAnnualHeadline, extractLenderBalanceSheet, extractOperatingFigures, parseXbrlInstance, selectAnnualContexts } from "../xbrlInstance";

/**
 * Shaped on ITC's FY24 consolidated results filing (NSE archive
 * INDAS_106840_1135573_23052024050307.xml): the YTD context `FourD` carries
 * the QUARTER's dates but the full-year values.
 */
const FILING = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
  <xbrli:context id="OneD"><xbrli:entity><xbrli:identifier scheme="x">500875</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="FourD"><xbrli:entity><xbrli:identifier scheme="x">500875</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="OneI"><xbrli:entity><xbrli:identifier scheme="x">500875</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:instant>2024-03-31</xbrli:instant></xbrli:period></xbrli:context>
  <xbrli:context id="OneReportableSegmentRevenue01D"><xbrli:entity><xbrli:identifier scheme="x">500875</xbrli:identifier>
    <xbrli:segment><xbrldi:explicitMember dimension="in-bse-fin:SegmentsAxis">in-bse-fin:Seg1</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2023-04-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>
  <in-bse-fin:RevenueFromOperations contextRef="OneD" unitRef="INR" decimals="-7">194464900000.00</in-bse-fin:RevenueFromOperations>
  <in-bse-fin:RevenueFromOperations contextRef="FourD" unitRef="INR" decimals="-7">768404900000.00</in-bse-fin:RevenueFromOperations>
  <in-bse-fin:RevenueFromOperations contextRef="OneReportableSegmentRevenue01D" unitRef="INR" decimals="-7">340000000000.00</in-bse-fin:RevenueFromOperations>
  <in-bse-fin:ProfitLossForPeriod contextRef="FourD" unitRef="INR" decimals="-7">207513600000.00</in-bse-fin:ProfitLossForPeriod>
  <in-bse-fin:Assets contextRef="OneI" unitRef="INR" decimals="-7">918261600000.00</in-bse-fin:Assets>
  <in-bse-fin:NameOfCompany contextRef="OneD">ITC Limited &amp; Subsidiaries</in-bse-fin:NameOfCompany>
</xbrli:xbrl>`;

describe("parseXbrlInstance", () => {
  it("reads contexts, dimensions and numeric and text facts", () => {
    const instance = parseXbrlInstance(FILING);
    expect(instance.contexts.size).toBe(4);
    expect(instance.contexts.get("OneReportableSegmentRevenue01D")!.dimensional).toBe(true);
    expect(instance.contexts.get("FourD")!.dimensional).toBe(false);
    const name = instance.facts.find((f) => f.concept === "NameOfCompany")!;
    expect(name.value).toBeNull();
    expect(name.text).toBe("ITC Limited & Subsidiaries");
  });
});

describe("extractAnnualHeadline", () => {
  it("takes the year-to-date context by ID even though it carries the quarter's dates", () => {
    const { headline, method } = extractAnnualHeadline(parseXbrlInstance(FILING), "2024-03-31");
    expect(method).toBe("id-convention");
    // ₹76,840 Cr — the full year — not the quarter's ₹19,446 Cr, nor a segment's figure.
    expect(headline.revenue).toBeCloseTo(76840.49, 2);
    expect(headline.profitAfterTax).toBeCloseTo(20751.36, 2);
    expect(headline.totalAssets).toBeCloseTo(91826.16, 2);
    expect(headline.cashFlowFromOperations).toBeNull();
  });

  it("reads the year's expenses, tax and regulatory deferral movement, which core operating income is built from", () => {
    const fact = (concept: string, context: string, rupees: string) =>
      `<in-bse-fin:${concept} contextRef="${context}" unitRef="INR" decimals="-7">${rupees}</in-bse-fin:${concept}>`;
    const lines = [
      fact("Expenses", "OneD", "140000000000.00"), fact("Expenses", "FourD", "530000000000.00"),
      fact("TaxExpense", "OneD", "18000000000.00"), fact("TaxExpense", "FourD", "70000000000.00"),
    ];
    const filing = FILING.replace("</xbrli:xbrl>", [...lines, "</xbrli:xbrl>"].join("\n"));
    const { headline } = extractAnnualHeadline(parseXbrlInstance(filing), "2024-03-31");
    expect([headline.expenses, headline.taxExpense]).toEqual([53000, 7000]);
    // Filed only by a rate-regulated entity: null elsewhere, not zero.
    expect(headline.regulatoryDeferralMovement).toBeNull();
    // NTPC FY2026-shaped: the movement is filed below profit before tax, with its sign.
    const regulated = filing.replace("</xbrli:xbrl>", `${fact("NetMovementInRegulatoryDeferralAccountBalancesRelatedToProfitOrLossAndTheRelatedDeferredTaxMovement", "FourD", "-24640000000.00")}\n</xbrli:xbrl>`);
    expect(extractAnnualHeadline(parseXbrlInstance(regulated), "2024-03-31").headline.regulatoryDeferralMovement).toBe(-2464);
  });

  it("reads the year's itemized excise duty, not the quarter's, though both carry the quarter's dates", () => {
    // ITC FY24: other expenses itemized per context, each labelled by a
    // description in the same context; the year's item contexts are named after
    // FourD, the quarter's after OneD, and the utility dates both as the quarter.
    const item = (id: string) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">500875</xbrli:identifier>
    <xbrli:segment><xbrldi:explicitMember dimension="in-bse-fin:OtherExpensesAxis">in-bse-fin:Item</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period></xbrli:context>`;
    const fact = (concept: string, context: string, body: string) => concept === "OtherExpenses"
      ? `<in-bse-fin:OtherExpenses contextRef="${context}" unitRef="INR" decimals="-7">${body}</in-bse-fin:OtherExpenses>`
      : `<in-bse-fin:DescriptionOfOtherExpenses contextRef="${context}">${body}</in-bse-fin:DescriptionOfOtherExpenses>`;
    const withExcise = FILING.replace("</xbrli:xbrl>", [
      item("OneOperatingExpenses01D"), item("FourOperatingExpenses01D"), item("FourOperatingExpenses02D"),
      fact("OtherExpenses", "OneOperatingExpenses01D", "15237900000.00"), fact("Description", "OneOperatingExpenses01D", "Excise Duty"),
      fact("OtherExpenses", "FourOperatingExpenses01D", "59594900000.00"), fact("Description", "FourOperatingExpenses01D", "Excise Duty"),
      fact("OtherExpenses", "FourOperatingExpenses02D", "112450900000.00"), fact("Description", "FourOperatingExpenses02D", "Other Expenses"),
      "</xbrli:xbrl>",
    ].join("\n"));
    expect(extractAnnualHeadline(parseXbrlInstance(withExcise), "2024-03-31").headline.exciseDuty).toBeCloseTo(5959.49, 2);
    // Not itemized: null, not zero.
    expect(extractAnnualHeadline(parseXbrlInstance(FILING), "2024-03-31").headline.exciseDuty).toBeNull();
  });

  it("reads shares in issue as paid-up capital over face value, the face value in its own unit", () => {
    // HDFC Bank FY26: ₹1,539.34 Cr paid up at ₹1 a share, after a 1:1 bonus.
    const withShares = FILING.replace("</xbrli:xbrl>", [
      `<in-capmkt:PaidUpValueOfEquityShareCapital contextRef="FourD" unitRef="INR" decimals="-5">15393400000</in-capmkt:PaidUpValueOfEquityShareCapital>`,
      `<in-capmkt:FaceValueOfEquityShareCapital contextRef="FourD" unitRef="INRPerShare" decimals="INF">1</in-capmkt:FaceValueOfEquityShareCapital>`,
      "</xbrli:xbrl>",
    ].join("\n"));
    expect(extractAnnualHeadline(parseXbrlInstance(withShares), "2024-03-31").headline.sharesOutstandingCr).toBeCloseTo(1539.34, 6);
    // At ₹10 a share the same capital is a tenth of the shares.
    expect(extractAnnualHeadline(parseXbrlInstance(withShares.replace(">1</in-capmkt:FaceValue", ">10</in-capmkt:FaceValue")), "2024-03-31").headline.sharesOutstandingCr)
      .toBeCloseTo(153.934, 6);
    expect(extractAnnualHeadline(parseXbrlInstance(FILING), "2024-03-31").headline.sharesOutstandingCr).toBeNull();
  });

  it("checks the face-value count against profit over EPS, and refuses it when a tag is wrong", () => {
    const filing = (paidUp: number, face: number, profit: number, eps: number) => FILING.replace("</xbrli:xbrl>", [
      `<in-capmkt:PaidUpValueOfEquityShareCapital contextRef="FourD" unitRef="INR" decimals="-5">${paidUp}</in-capmkt:PaidUpValueOfEquityShareCapital>`,
      `<in-capmkt:FaceValueOfEquityShareCapital contextRef="FourD" unitRef="INRPerShare" decimals="INF">${face}</in-capmkt:FaceValueOfEquityShareCapital>`,
      `<in-capmkt:ProfitOrLossAttributableToOwnersOfParent contextRef="FourD" unitRef="INR" decimals="-5">${profit}</in-capmkt:ProfitOrLossAttributableToOwnersOfParent>`,
      `<in-capmkt:BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations contextRef="FourD" unitRef="INRPerShare" decimals="INF">${eps}</in-capmkt:BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations>`,
      "</xbrli:xbrl>",
    ].join("\n"));
    const shares = (xml: string) => extractAnnualHeadline(parseXbrlInstance(xml), "2024-03-31").headline.sharesOutstandingCr;
    // Maruti FY24: EPS filed at twice its profit per share; the capital tags stand.
    expect(shares(filing(1572000000, 5, 134882000000, 858.02))).toBeCloseTo(31.44, 6);
    // Sun Pharma FY25: face value filed as 719,780.9 against ₹45.6 EPS on ₹10,929 Cr.
    expect(shares(filing(2399300000, 719780.9, 109290000000, 45.6))).toBeNull();
  });

  it("counts a life insurer's shares as profit over EPS, its filing tagging no face value", () => {
    // HDFC Life FY26: ₹1,912.32 Cr at ₹8.86 a share; ₹2,157.82 Cr paid up, at ₹10.
    const insurer = FILING.replace("</xbrli:xbrl>", [
      `<in-capmkt:PaidUpEquityShareCapital contextRef="OneI" unitRef="INR" decimals="-5">21578200000</in-capmkt:PaidUpEquityShareCapital>`,
      `<in-capmkt:ProfitLossAfterTaxAndExtraordinaryItems contextRef="FourD" unitRef="INR" decimals="-5">19123200000</in-capmkt:ProfitLossAfterTaxAndExtraordinaryItems>`,
      `<in-capmkt:BasicAndDilutedEPSAfterExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized contextRef="FourD" unitRef="INRPerShare" decimals="INF">8.86</in-capmkt:BasicAndDilutedEPSAfterExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized>`,
      "</xbrli:xbrl>",
    ].join("\n"));
    expect(extractAnnualHeadline(parseXbrlInstance(insurer), "2024-03-31").headline.sharesOutstandingCr).toBeCloseTo(1912.32 / 8.86, 6);
  });

  it("falls back to a genuine 12-month span when the ID convention is absent", () => {
    const renamed = FILING
      .replace(/id="FourD"/, 'id="Annual"')
      .replace(/contextRef="FourD"/g, 'contextRef="Annual"')
      .replace('<xbrli:context id="Annual"><xbrli:entity><xbrli:identifier scheme="x">500875</xbrli:identifier></xbrli:entity>\n    <xbrli:period><xbrli:startDate>2024-01-01', '<xbrli:context id="Annual"><xbrli:entity><xbrli:identifier scheme="x">500875</xbrli:identifier></xbrli:entity>\n    <xbrli:period><xbrli:startDate>2023-04-01');
    const { duration, method } = selectAnnualContexts(parseXbrlInstance(renamed), "2024-03-31");
    expect(method).toBe("date-span");
    expect(duration!.id).toBe("Annual");
  });

  it("reads convention contexts that facts reference but the filing never declares", () => {
    // Older utility output (ITC FY18–FY22) omits the OneD/FourD/OneI declarations.
    const undeclared = FILING.replace(/<xbrli:context id="(OneD|FourD|OneI)">[\s\S]*?<\/xbrli:context>/g, "");
    const { headline, method } = extractAnnualHeadline(parseXbrlInstance(undeclared), "2024-03-31");
    expect(method).toBe("id-convention-undeclared");
    expect(headline.revenue).toBeCloseTo(76840.49, 2);
    expect(headline.totalAssets).toBeCloseTo(91826.16, 2);
  });

  it("refuses to guess when neither the convention nor a 12-month span exists", () => {
    const quarterOnly = FILING.replace(/id="FourD"/, 'id="Q4"').replace(/contextRef="FourD"/g, 'contextRef="Q4"');
    const { headline, method } = extractAnnualHeadline(parseXbrlInstance(quarterOnly), "2024-03-31");
    expect(method).toBe("none");
    expect(headline.revenue).toBeNull();
  });
});

/**
 * Shaped on Mahindra & Mahindra Financial's FY22 consolidated results filing
 * (NSE archive NBFC_INDAS_83874_650627_03052022034538_WEB.xml), ₹ crore × 1e7:
 * the Division III subtotals, with no `Assets`, `Equity` or cash line, and the
 * taxonomy's own spelling of `FinanicalAssets`.
 */
const NBFC_FILING = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin" xmlns:xbrli="http://www.xbrl.org/2003/instance">
  <xbrli:context id="OneI"><xbrli:entity><xbrli:identifier scheme="x">532720</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:instant>2022-03-31</xbrli:instant></xbrli:period></xbrli:context>
  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>
  <in-bse-fin:FinanicalAssets contextRef="OneI" unitRef="INR" decimals="-5">815040000000</in-bse-fin:FinanicalAssets>
  <in-bse-fin:NonFinancialAssets contextRef="OneI" unitRef="INR" decimals="-5">23050000000</in-bse-fin:NonFinancialAssets>
  <in-bse-fin:Loans contextRef="OneI" unitRef="INR" decimals="-5">676600000000</in-bse-fin:Loans>
  <in-bse-fin:TradeReceivables contextRef="OneI" unitRef="INR" decimals="-5">650000000</in-bse-fin:TradeReceivables>
  <in-bse-fin:FinancialLiabilities contextRef="OneI" unitRef="INR" decimals="-5">663470000000</in-bse-fin:FinancialLiabilities>
  <in-bse-fin:NonFinancialLiabilities contextRef="OneI" unitRef="INR" decimals="-5">4240000000</in-bse-fin:NonFinancialLiabilities>
  <in-bse-fin:TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterprise contextRef="OneI" unitRef="INR" decimals="-5">11130000000</in-bse-fin:TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterprise>
  <in-bse-fin:TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterpriseOtherPayables contextRef="OneI" unitRef="INR" decimals="-5">470000000</in-bse-fin:TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterpriseOtherPayables>
  <in-bse-fin:EquityShareCapital contextRef="OneI" unitRef="INR" decimals="-5">2470000000</in-bse-fin:EquityShareCapital>
</xbrli:xbrl>`;

describe("extractLenderBalanceSheet", () => {
  it("reads the Division III subtotals, the taxonomy's misspelt financial assets among them", () => {
    const bs = extractLenderBalanceSheet(parseXbrlInstance(NBFC_FILING), "2022-03-31")!;
    expect(bs.financialAssets).toBeCloseTo(81504, 2);
    expect(bs.nonFinancialAssets).toBeCloseTo(2305, 2);
    expect(bs.loans).toBeCloseTo(67660, 2);
    expect(bs.receivables).toBeCloseTo(65, 2);
    expect(bs.financialLiabilities).toBeCloseTo(66347, 2);
    expect(bs.nonFinancialLiabilities).toBeCloseTo(424, 2);
    // Both payables lines, trade and other.
    expect(bs.payables).toBeCloseTo(1160, 2);
    // Share capital alone is not the owners' equity: other equity is untagged.
    expect(bs.ownersEquity).toBeNull();
  });

  it("is null for a filing that is not in the lender format", () => {
    expect(extractLenderBalanceSheet(parseXbrlInstance(FILING), "2024-03-31")).toBeNull();
  });
});

/**
 * Shaped on ITC's FY23 consolidated results filing (NSE archive
 * INDAS_91997_845894_18052023055947.xml): the first year a results filing
 * carries a balance sheet, its lines split current and non-current.
 */
const BALANCE_SHEET_FILING = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin" xmlns:xbrli="http://www.xbrl.org/2003/instance">
  <xbrli:context id="OneD"><xbrli:entity><xbrli:identifier scheme="x">ITC</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2023-01-01</xbrli:startDate><xbrli:endDate>2023-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="FourD"><xbrli:entity><xbrli:identifier scheme="x">ITC</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2023-01-01</xbrli:startDate><xbrli:endDate>2023-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="OneI"><xbrli:entity><xbrli:identifier scheme="x">ITC</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:instant>2023-03-31</xbrli:instant></xbrli:period></xbrli:context>
  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>
  <in-bse-fin:RevenueFromOperations contextRef="OneD" unitRef="INR" decimals="-7">190582900000.00</in-bse-fin:RevenueFromOperations>
  <in-bse-fin:RevenueFromOperations contextRef="FourD" unitRef="INR" decimals="-7">765182100000.00</in-bse-fin:RevenueFromOperations>
  <in-bse-fin:FinanceCosts contextRef="FourD" unitRef="INR" decimals="-7">432000000.00</in-bse-fin:FinanceCosts>
  <in-bse-fin:Expenses contextRef="FourD" unitRef="INR" decimals="-7">527054900000.00</in-bse-fin:Expenses>
  <in-bse-fin:ProfitBeforeTax contextRef="FourD" unitRef="INR" decimals="-7">258660800000.00</in-bse-fin:ProfitBeforeTax>
  <in-bse-fin:TaxExpense contextRef="FourD" unitRef="INR" decimals="-7">64384000000.00</in-bse-fin:TaxExpense>
  <in-bse-fin:NoncurrentInvestments contextRef="OneI" unitRef="INR" decimals="-7">118445700000.00</in-bse-fin:NoncurrentInvestments>
  <in-bse-fin:CurrentInvestments contextRef="OneI" unitRef="INR" decimals="-7">172328600000.00</in-bse-fin:CurrentInvestments>
  <in-bse-fin:CashAndCashEquivalents contextRef="OneI" unitRef="INR" decimals="-7">4633500000.00</in-bse-fin:CashAndCashEquivalents>
  <in-bse-fin:BankBalanceOtherThanCashAndCashEquivalents contextRef="OneI" unitRef="INR" decimals="-7">44168400000.00</in-bse-fin:BankBalanceOtherThanCashAndCashEquivalents>
  <in-bse-fin:LoansNoncurrent contextRef="OneI" unitRef="INR" decimals="-7">54800000.00</in-bse-fin:LoansNoncurrent>
  <in-bse-fin:LoansCurrent contextRef="OneI" unitRef="INR" decimals="-7">71200000.00</in-bse-fin:LoansCurrent>
  <in-bse-fin:Assets contextRef="OneI" unitRef="INR" decimals="-7">858829800000.00</in-bse-fin:Assets>
  <in-bse-fin:Equity contextRef="OneI" unitRef="INR" decimals="-7">695387900000.00</in-bse-fin:Equity>
  <in-bse-fin:BorrowingsNoncurrent contextRef="OneI" unitRef="INR" decimals="-7">34900000.00</in-bse-fin:BorrowingsNoncurrent>
  <in-bse-fin:BorrowingsCurrent contextRef="OneI" unitRef="INR" decimals="-7">353200000.00</in-bse-fin:BorrowingsCurrent>
</xbrli:xbrl>`;

describe("extractOperatingFigures", () => {
  it("reads the year's totals by the ID convention and sums each balance-sheet line's current and non-current parts", () => {
    const f = extractOperatingFigures(parseXbrlInstance(BALANCE_SHEET_FILING), "2023-03-31");
    // The full year's ₹76,518 Cr, not the quarter's ₹19,058 Cr.
    expect(f.revenue).toBeCloseTo(76518.21, 2);
    expect(f.expenses).toBeCloseTo(52705.49, 2);
    expect(f.financeCosts).toBeCloseTo(43.2, 2);
    expect(f.profitBeforeTax).toBeCloseTo(25866.08, 2);
    expect(f.taxExpense).toBeCloseTo(6438.4, 2);
    expect(f.assets).toBeCloseTo(85882.98, 2);
    expect(f.equity).toBeCloseTo(69538.79, 2);
    expect(f.borrowings).toBeCloseTo(3.49 + 35.32, 2);
    expect(f.cash).toBeCloseTo(463.35 + 4416.84, 2);
    expect(f.investments).toBeCloseTo(17232.86 + 11844.57, 2);
    expect(f.loans).toBeCloseTo(5.48 + 7.12, 2);
  });

  it("leaves the balance sheet null for a results filing that carries none (before FY2023)", () => {
    const f = extractOperatingFigures(parseXbrlInstance(FILING.replace(/<in-bse-fin:Assets .*<\/in-bse-fin:Assets>/, "")), "2024-03-31");
    expect(f.revenue).toBeCloseTo(76840.49, 2);
    expect(f.assets).toBeNull();
    expect(f.equity).toBeNull();
    expect(f.borrowings).toBeNull();
  });
});

describe("tieOutAsFiled", () => {
  const headline = {
    revenue: 76840.49, profitBeforeTax: null, profitAfterTax: 20751.36, profitAttributableToOwners: null,
    profitFromContinuingOperations: null, profitFromDiscontinuedOperations: null,
    financeCosts: null, totalAssets: 91826.16, totalEquity: 74889.97, equityAttributableToOwners: 74507,
    cashFlowFromOperations: null,
  };
  const period = {
    period_end: "2024-03-31",
    is: { Sales: 76840.49, PAT: 20751.36 },
    bs: { TA: 93000, CSE: 74507, MI: 382.97 },
    cf: { CFO: 17000 },
  } as unknown as import("../../types").RecastPeriod;

  it("classifies each field and uses the FIRST filing for a year as the as-reported figure", async () => {
    const { tieOutAsFiled } = await import("../tieOut");
    const restated = { ...headline, revenue: 70000 };
    const rows = tieOutAsFiled(
      [
        { fiscalYearEnd: "2024-03-31", filingDate: "2024-05-23T17:03", headline },
        { fiscalYearEnd: "2024-03-31", filingDate: "2025-05-22T10:00", headline: restated },
      ],
      [period],
    );
    const by = (field: string) => rows.find((r) => r.field === field)!;
    expect(by("revenue").status).toBe("match");
    expect(by("revenue").asFiled).toBe(76840.49);
    // Total equity (incl. NCI) ties to CSE + MI.
    expect(by("totalEquity").status).toBe("match");
    // 93,000 vs 91,826 is 1.3%: minor, not a match.
    expect(by("totalAssets").status).toBe("minor");
    // A field the filing did not carry is not scored.
    expect(rows.find((r) => r.field === "cashFlowFromOperations")).toBeUndefined();
  });
});

describe("headlineInconsistencies", () => {
  it("discredits an as-filed PAT that contradicts its own filing", async () => {
    const { headlineInconsistencies, tieOutAsFiled } = await import("../tieOut");
    // Asian Paints FY22 as filed: PAT 9,167 vs PBT 4,156 and owners' profit 3,031.
    const filed = {
      revenue: 29101.28, profitBeforeTax: 4156.15, profitAfterTax: 9167.37, profitAttributableToOwners: 3030.57,
      profitFromContinuingOperations: null, profitFromDiscontinuedOperations: null,
      financeCosts: null, totalAssets: null, totalEquity: null, equityAttributableToOwners: null, cashFlowFromOperations: null,
    };
    expect(headlineInconsistencies(filed).has("profitAfterTax")).toBe(true);
    const period = { period_end: "2022-03-31", is: { Sales: 29101.28, PAT: 3085 }, bs: { TA: 0, CSE: 0, MI: 0 }, cf: {} } as unknown as import("../../types").RecastPeriod;
    const rows = tieOutAsFiled([{ fiscalYearEnd: "2022-03-31", filingDate: "2022-05-10T23:03", headline: filed }], [period]);
    expect(rows.find((r) => r.field === "profitAfterTax")!.status).toBe("filing-inconsistent");
    expect(rows.find((r) => r.field === "revenue")!.status).toBe("match");
  });

  it("does not discredit a PAT lifted by a discontinued-operations gain", async () => {
    const { headlineInconsistencies } = await import("../tieOut");
    // L&T FY21 as filed: continuing 4,669 + discontinued 8,238 = 12,921; PBT 8,542.
    const filed = {
      revenue: 135979, profitBeforeTax: 8542.02, profitAfterTax: 12921.28, profitAttributableToOwners: 11582.93,
      profitFromContinuingOperations: 4668.96, profitFromDiscontinuedOperations: 8237.92,
      financeCosts: null, totalAssets: null, totalEquity: null, equityAttributableToOwners: null, cashFlowFromOperations: null,
    };
    expect(headlineInconsistencies(filed).has("profitAfterTax")).toBe(false);
  });
});
