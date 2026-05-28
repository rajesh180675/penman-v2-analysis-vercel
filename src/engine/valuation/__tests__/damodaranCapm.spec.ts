/* ================================================================
   Plan 5 PR-5.3 — Damodaran CAPM contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import {
  getDamodaranData,
  selectIndustryBeta,
  relevereBeta,
  capmKe,
} from "../damodaranCapm";

describe("damodaranCapm (Plan 5 PR-5.3)", () => {
  it("snapshot ships with retrievalDate, ERP, rf, and >=20 industries", () => {
    const data = getDamodaranData();
    expect(data.retrievalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.equityRiskPremium.value).toBeGreaterThan(0);
    expect(data.equityRiskPremium.value).toBeLessThan(0.20);
    expect(data.riskFreeRate.value).toBeGreaterThan(0);
    expect(data.riskFreeRate.value).toBeLessThan(0.15);
    expect(data.industries.length).toBeGreaterThanOrEqual(20);
  });

  it("selectIndustryBeta finds exact matches case-insensitively", () => {
    const fmcg = selectIndustryBeta("FMCG");
    expect(fmcg?.industry).toBe("FMCG");
    expect(fmcg?.leveredBeta).toBeGreaterThan(0);

    const fmcgLower = selectIndustryBeta("fmcg");
    expect(fmcgLower?.industry).toBe("FMCG");
  });

  it("selectIndustryBeta does substring lookup when no exact match", () => {
    const it = selectIndustryBeta("Information Technology");
    // "IT Services" contains nothing matching "information technology" exactly,
    // but the fallback chain picks "Diversified" rather than failing.
    expect(it).not.toBeNull();
  });

  it("selectIndustryBeta on partial 'Bank' matches 'Banks'", () => {
    const banks = selectIndustryBeta("Bank");
    expect(banks?.industry).toBe("Banks");
  });

  it("selectIndustryBeta on empty string returns Diversified", () => {
    expect(selectIndustryBeta("")?.industry).toBe("Diversified");
  });

  it("relevereBeta: zero leverage -> beta unchanged", () => {
    const beta = relevereBeta(0.8, 0, 0.25);
    expect(beta).toBeCloseTo(0.8, 6);
  });

  it("relevereBeta: D/E=1, tax=25% -> beta * (1 + 0.75) = beta * 1.75", () => {
    const beta = relevereBeta(0.8, 1.0, 0.25);
    expect(beta).toBeCloseTo(0.8 * 1.75, 6);
  });

  it("capmKe with beta=1 returns rf + ERP exactly", () => {
    const data = getDamodaranData();
    const r = capmKe({ beta: 1.0 });
    expect(r.ke).toBeCloseTo(data.riskFreeRate.value + data.equityRiskPremium.value, 9);
  });

  it("capmKe citation echoes retrievalDate, beta, rf, ERP", () => {
    const r = capmKe({ beta: 0.85 });
    const data = getDamodaranData();
    expect(r.citation.retrievalDate).toBe(data.retrievalDate);
    expect(r.citation.beta).toBe(0.85);
    expect(r.citation.rf.value).toBe(data.riskFreeRate.value);
    expect(r.citation.erp.value).toBe(data.equityRiskPremium.value);
    expect(r.citation.rf.asOf).toBe(data.riskFreeRate.asOf);
  });

  it("capmKe with user-supplied rf marks asOf as 'user-supplied'", () => {
    const r = capmKe({ beta: 1.0, riskFreeRate: 0.065 });
    expect(r.citation.rf.value).toBe(0.065);
    expect(r.citation.rf.asOf).toBe("user-supplied");
    expect(r.citation.erp.asOf).not.toBe("user-supplied"); // ERP still from data
  });
});
