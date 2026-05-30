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
      valuationBlocked: true,
      valuationStatus: "guarded",
      minPeriods: 15,
      requiredTerminalFlags: [
        "STRUCTURAL_EVENT",
        "PM_OUTLIER_CRITICAL",
        "ROCE_OUTLIER_CRITICAL",
        "RNOA_OUTLIER_CRITICAL",
      ],
 ratioRanges: {
 ROCE: [0.45, 0.50], // actual 0.4764 ± 5%
 RNOA: [1.00, 1.12], // actual 1.0593 ± 5%
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
      valuationStatus: "warning",
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
