/**
 * Phase B5.1 — bankQualityIndicators contract tests
 *
 * Pins the schema validation, plausibility-band warnings, period
 * indexing, and the loader's "absent sidecar" tolerance.
 */

import { describe, it, expect, vi } from "vitest";
import {
  BANK_QUALITY_SCHEMA_VERSION,
  validateBankQualityIndicators,
  indexQualityByPeriod,
  fetchBankQualityIndicators,
  type BankQualityIndicators,
} from "../bankQualityIndicators";

const baseValid: BankQualityIndicators = {
  schema_version: BANK_QUALITY_SCHEMA_VERSION,
  company_name: "HDFC Bank Ltd",
  as_of_date: "2025-03-31",
  periods: [
    {
      period_end: "2025-03-31",
      fiscal_label: "FY25",
      gnpa_pct: 1.33,
      nnpa_pct: 0.43,
      pcr_pct: 67.92,
      crar_pct: 19.6,
      tier1_pct: 17.69,
      casa_pct: 34.36,
      advances_growth_pct: 5.4,
      deposits_growth_pct: 14.1,
      source_doc: "HDFCBANK_AR_FY2025.pdf",
      source_page: 198,
    },
    {
      period_end: "2024-03-31",
      fiscal_label: "FY24",
      gnpa_pct: 1.24,
      nnpa_pct: 0.33,
      pcr_pct: 73.92,
      crar_pct: 18.8,
    },
  ],
};

describe("validateBankQualityIndicators", () => {
  it("accepts a well-formed payload", () => {
    const r = validateBankQualityIndicators(baseValid);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("rejects schema-version mismatches", () => {
    const r = validateBankQualityIndicators({ ...baseValid, schema_version: "0.0.0" });
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.field).toBe("schema_version");
  });

  it("rejects missing required strings", () => {
    const r = validateBankQualityIndicators({ ...baseValid, company_name: "" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "company_name")).toBe(true);
  });

  it("rejects malformed period_end dates", () => {
    const r = validateBankQualityIndicators({
      ...baseValid,
      periods: [{ ...baseValid.periods[0], period_end: "FY25" }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toMatch(/ISO date/);
  });

  it("rejects duplicate period_end", () => {
    const r = validateBankQualityIndicators({
      ...baseValid,
      periods: [baseValid.periods[0], baseValid.periods[0]],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message === "duplicate period_end")).toBe(true);
  });

  it("warns (does not error) on out-of-band ratios", () => {
    const r = validateBankQualityIndicators({
      ...baseValid,
      periods: [{ ...baseValid.periods[0], gnpa_pct: 99 }], // wildly high but plausibly typo
    });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.severity === "warning")).toBe(true);
  });

  it("warns when NNPA > GNPA (definitionally impossible)", () => {
    const r = validateBankQualityIndicators({
      ...baseValid,
      periods: [{ ...baseValid.periods[0], gnpa_pct: 1.0, nnpa_pct: 2.0 }],
    });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.message.match(/NNPA.*GNPA/))).toBe(true);
  });

  it("warns when Tier-1 > CRAR (definitionally impossible)", () => {
    const r = validateBankQualityIndicators({
      ...baseValid,
      periods: [{ ...baseValid.periods[0], crar_pct: 15, tier1_pct: 18 }],
    });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.message.match(/Tier-1.*CRAR/))).toBe(true);
  });

  it("rejects non-array payload root", () => {
    expect(validateBankQualityIndicators(null).ok).toBe(false);
    expect(validateBankQualityIndicators("string").ok).toBe(false);
  });

  it("rejects non-finite ratio values", () => {
    const r = validateBankQualityIndicators({
      ...baseValid,
      periods: [{ ...baseValid.periods[0], gnpa_pct: NaN as unknown as number }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("indexQualityByPeriod", () => {
  it("indexes by period_end for O(1) lookup", () => {
    const map = indexQualityByPeriod(baseValid);
    expect(map.size).toBe(2);
    expect(map.get("2025-03-31")?.gnpa_pct).toBe(1.33);
    expect(map.get("2024-03-31")?.gnpa_pct).toBe(1.24);
  });

  it("handles null/undefined input", () => {
    expect(indexQualityByPeriod(null).size).toBe(0);
    expect(indexQualityByPeriod(undefined).size).toBe(0);
  });
});

describe("fetchBankQualityIndicators", () => {
  it("returns null on 404 (sidecar is optional)", async () => {
    const fakeFetch = vi.fn(async () => new Response(null, { status: 404 }));
    const result = await fetchBankQualityIndicators("X", fakeFetch as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null on network error (graceful degradation)", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const result = await fetchBankQualityIndicators("X", fakeFetch as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("throws on schema-version mismatch (silent corruption is worse than loud failure)", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ...baseValid, schema_version: "0.0.0" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      fetchBankQualityIndicators("X", fakeFetch as unknown as typeof fetch),
    ).rejects.toThrow(/schema_version/);
  });

  it("throws on malformed JSON", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response("not json {{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      fetchBankQualityIndicators("X", fakeFetch as unknown as typeof fetch),
    ).rejects.toThrow(/JSON parse failed/);
  });

  it("returns parsed payload on a 200 with valid JSON", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify(baseValid), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await fetchBankQualityIndicators(
      "HDFC Bank",
      fakeFetch as unknown as typeof fetch,
    );
    expect(result?.company_name).toBe("HDFC Bank Ltd");
    // Verify the URL is properly encoded
    expect(fakeFetch).toHaveBeenCalledWith(
      expect.stringContaining("HDFC%20Bank/quality_indicators.json"),
    );
  });
});
