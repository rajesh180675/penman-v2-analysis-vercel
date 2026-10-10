import asianPaintsAuditedFixture from "../__fixtures__/asian-paints-capitaline-audited.json";
import itcAuditedFixture from "../__fixtures__/itc-capitaline-audited.json";
import { RawPeriodData, DEFAULT_CONFIG } from "../types";
import { GoldenCompanyCase } from "./types";
import {
  vstRealCompanySample,
  netCashCompounder,
  leveragedIndustrial,
  exceptionalEventIssuer,
} from "./fixtures";

export const GOLDEN_COMPANY_CASES: GoldenCompanyCase[] = [
  {
    id: "itc-audited-run",
    companyId: "ITC",
    source: "audited-run",
    note: "Real audited production run captured from Vercel on 2026-03-29.",
    rawData: (itcAuditedFixture as { rawData: RawPeriodData[] }).rawData,
    config: { ...DEFAULT_CONFIG, company_type: "industrial" as const },
    expectation: {
      qualityGateTier: "Tier 1",
      valuationBlocked: false,
      valuationStatus: "production-ready",
      minPeriods: 15,
      // FY25 is the ITC Hotels demerger. The equity that left is a distribution
      // to owners, and the business earned 2.5% of FY24 OI (the comparative
      // files it as discontinued), so the post-demerger book anchors. The
      // demerger gain is filed as discontinued, so core OI and core residual
      // earnings hold: the one-off checks say so without blocking. PM/ROCE/RNOA
      // outliers are still flagged but never block a terminal anchor alone.
      requiredTerminalFlags: [
        "DEMERGER_LIKELY",
        "INCREMENTAL_MARGIN_ITEMIZED",
        "TERMINAL_RE_ITEMIZED",
      ],
      forbiddenTerminalFlags: [
        "STRUCTURAL_EVENT",
        "DIRTY_SURPLUS_SPIKE",
        "INCREMENTAL_MARGIN_ANOMALY",
        "TERMINAL_RE_ANOMALY",
      ],
 ratioRanges: {
 ROCE: [0.45, 0.50], // actual 0.4764 ± 5%
 // actual 0.9216 ± 5%. Was 1.0593 while "Total Other Bank Balances" was
 // summed beside the equal "Bank Balances Other Than Cash…" line (3,392.36
 // in FY25), counting that cash twice and understating NOA.
 RNOA: [0.875, 0.968],
 NBC: [0.020, 0.035], // ITC is net-cash (FA >> FO); NBC = NFE/NFO = neg/neg > 0 (return on net financial assets)
 },
    },
  },
  {
    id: "asian-paints-audited-run",
    companyId: "ASIAN PAINTS",
    source: "audited-run",
    note: "Real audited Capitaline run for a clean supported industrial issuer with complete artifact capture.",
    rawData: asianPaintsAuditedFixture.rawData as RawPeriodData[],
    config: { ...DEFAULT_CONFIG, company_type: "industrial" as const },
    expectation: {
      qualityGateTier: "Tier 1",
      valuationBlocked: false,
      valuationStatus: "production-ready",
      persistenceStatus: "durable",
      minPeriods: 10,
      forbiddenTerminalFlags: ["STRUCTURAL_EVENT", "CAPITAL_TRANSACTION_LIKELY"],
      ratioRanges: {
        ROCE: [0.19, 0.22],   // actual 0.2049 ± 5%
        RNOA: [0.24, 0.27],   // actual 0.2526 ± 5%
      },
    },
  },
  {
    id: "vst-real-company-sample",
    companyId: "VST",
    source: "real-company-sample",
    note: "Real-company sample embedded in the product and normalized into audited-suite shape.",
    rawData: vstRealCompanySample,
    expectation: {
      qualityGateTier: "Tier 2",
      valuationBlocked: true,
      valuationStatus: "guarded",
      minPeriods: 5,
      ratioRanges: {
        ROCE: [0.2, 1.5],
        FLEV: [-1.1, 0.05],
      },
    },
  },
  {
    id: "netcash-consumer",
    companyId: "NETCASH_CONSUMER",
    source: "curated-contrast",
    note: "Clean net-cash compounder with stable economics.",
    rawData: netCashCompounder,
    expectation: {
      qualityGateTier: "Tier 2",
      valuationBlocked: false,
      valuationStatus: "production-ready",
      persistenceStatus: "durable",
      minPeriods: 3,
      forbiddenTerminalFlags: ["STRUCTURAL_EVENT", "CAPITAL_TRANSACTION_LIKELY"],
      ratioRanges: {
        ROCE: [0.12, 0.3],
        RNOA: [0.18, 0.35],
        FLEV: [-1.0, 0.05],
      },
    },
  },
  {
    id: "leveraged-industrial",
    companyId: "LEVERAGED_INDUSTRIAL",
    source: "curated-contrast",
    note: "Debt-funded industrial with healthy but leveraged operating structure.",
    rawData: leveragedIndustrial,
    expectation: {
      qualityGateTier: "Tier 1",
      valuationBlocked: false,
      // Was "warning" only because its latest year carries an S-5.2
      // capital-transaction warning, which no longer disqualifies the anchor
      // (#367); no other flag touches the terminal period.
      valuationStatus: "production-ready",
      persistenceStatus: "durable",
      minPeriods: 3,
      forbiddenTerminalFlags: ["STRUCTURAL_EVENT"],
      ratioRanges: {
        ROCE: [0.12, 0.3],
        RNOA: [0.08, 0.25],
        FLEV: [0.3, 1.5],
      },
    },
  },
  {
    id: "exceptional-event-issuer",
    companyId: "EXCEPTIONAL_EVENT_CO",
    source: "curated-contrast",
    note: "Issuer with a structurally contaminated latest year driven by exceptional and discontinued items.",
    rawData: exceptionalEventIssuer,
    expectation: {
      qualityGateTier: "Tier 2",
      valuationBlocked: true,
      valuationStatus: "guarded",
      persistenceStatus: "mixed",
      minPeriods: 3,
      requiredTerminalFlags: ["STRUCTURAL_EVENT"],
      ratioRanges: {
        ROCE: [0.2, 0.8],
        NBC: [0, 0.2],
      },
    },
  },
];
