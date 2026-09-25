import { describe, expect, it } from "vitest";
import { extractAnnualHeadline, parseXbrlInstance, selectAnnualContexts } from "../xbrlInstance";

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
