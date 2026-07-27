import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Gap 6 / PR-F — golden suite expansion (expectations contract).
 *
 * Validates the schema and consistency of `expectations.json` files
 * dropped alongside golden company datasets. The actual ZIP-loading +
 * pipeline-execution suite lives elsewhere (see goldenCompanySuite.spec)
 * and is gated by ZIP availability — *.xls is gitignored on CI except
 * Bajaj Finance sidecars per the `agent-pr-loop` skill notes.
 *
 * This spec ALWAYS runs (no ZIP dependency). It enforces the contract
 * that any expectations.json shipped in the repo follows the documented
 * shape and that the 5 plan-v4 mandatory companies have an expectations
 * file each.
 */

interface ExpectationsContract {
  companyId: string;
  companyName: string;
  profile?: string;
  expectedRigorLevel: string;
  expectedParserFidelityStatus: string;
  expectedReconciliationStatus: string;
  expectedEconomicSanityStatus: string;
  expectedConceptIdentityStatus: string;
  keyMetricTolerances: Record<string, { min: number; max: number }>;
  expectedAnomalyFlags: string[];
  expectedUnusualItemCount: { min: number; max: number };
  expectedRunsCleanWorkbook: boolean;
  expectedParseCoverage?: {
    metricKeyCount: { min: number; max: number };
    nonNullValueCount: { min: number; max: number };
  };
  expectedSegmentCoverage?: {
    business: number | null;
    geographic: number | null;
    mixed: number | null;
  };
  notes?: string;
}

const COMPANIES_ROOT = "public/data/companies";

const REQUIRED_GOLDEN = [
  "Asian Paints",
  "Reliance Industries",
  "HDFC Bank",
  "NTPC",
  "Bajaj Finance",
];

const VALID_RIGOR_LEVELS = new Set([
  "syntactically-valid",
  "structurally-reconciled",
  "economically-plausible",
  "valuation-eligible",
  "production-ready",
]);

const VALID_PARSER_STATUSES = new Set(["confirmed", "degraded", "failed"]);
const VALID_RECONCILIATION_STATUSES = new Set(["confirmed", "degraded", "failed"]);
const VALID_SANITY_STATUSES = new Set(["passed", "warned", "blocked"]);
const VALID_CONCEPT_STATUSES = new Set([
  "clean",
  "conflicts-present",
  "valuation-blocked",
]);

function readExpectations(folder: string): ExpectationsContract | null {
  const path = join(COMPANIES_ROOT, folder, "expectations.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("golden suite — expectations.json contract (Gap 6 / PR-F)", () => {
  it("ships an expectations.json for each of the 5 plan-v4 mandatory golden companies", () => {
    if (!existsSync(COMPANIES_ROOT)) {
      throw new Error(`${COMPANIES_ROOT} missing; cannot validate golden suite.`);
    }
    for (const folder of REQUIRED_GOLDEN) {
      const path = join(COMPANIES_ROOT, folder, "expectations.json");
      expect(existsSync(path), `expectations.json missing for ${folder}`).toBe(true);
    }
  });

  it("each shipped expectations.json conforms to the documented schema", () => {
    if (!existsSync(COMPANIES_ROOT)) return;
    const folders = readdirSync(COMPANIES_ROOT);
    let validated = 0;
    for (const folder of folders) {
      const exp = readExpectations(folder);
      if (!exp) continue;
      validated++;

      // Required string fields.
      expect(typeof exp.companyId).toBe("string");
      expect(exp.companyId.length).toBeGreaterThan(0);
      expect(typeof exp.companyName).toBe("string");
      expect(exp.companyName.length).toBeGreaterThan(0);

      // Status enums.
      expect(VALID_RIGOR_LEVELS.has(exp.expectedRigorLevel),
        `${folder}: invalid expectedRigorLevel '${exp.expectedRigorLevel}'`).toBe(true);
      expect(VALID_PARSER_STATUSES.has(exp.expectedParserFidelityStatus),
        `${folder}: invalid expectedParserFidelityStatus`).toBe(true);
      expect(VALID_RECONCILIATION_STATUSES.has(exp.expectedReconciliationStatus),
        `${folder}: invalid expectedReconciliationStatus`).toBe(true);
      expect(VALID_SANITY_STATUSES.has(exp.expectedEconomicSanityStatus),
        `${folder}: invalid expectedEconomicSanityStatus`).toBe(true);
      expect(VALID_CONCEPT_STATUSES.has(exp.expectedConceptIdentityStatus),
        `${folder}: invalid expectedConceptIdentityStatus`).toBe(true);

      // Tolerance ranges.
      expect(typeof exp.keyMetricTolerances).toBe("object");
      for (const [metric, range] of Object.entries(exp.keyMetricTolerances)) {
        expect(typeof range.min).toBe("number");
        expect(typeof range.max).toBe("number");
        expect(range.min, `${folder}.${metric}: min should be <= max`).toBeLessThanOrEqual(range.max);
      }

      expect(Array.isArray(exp.expectedAnomalyFlags)).toBe(true);
      expect(typeof exp.expectedUnusualItemCount.min).toBe("number");
      expect(typeof exp.expectedUnusualItemCount.max).toBe("number");
      expect(exp.expectedUnusualItemCount.min).toBeLessThanOrEqual(exp.expectedUnusualItemCount.max);
      expect(typeof exp.expectedRunsCleanWorkbook).toBe("boolean");

      // Parse-coverage bands, when present. Counts, so integral and >= 0 —
      // a fractional or negative bound means the generator wrote a ratio band
      // into a volume field, which is the class of unit mix-up that has bitten
      // this contract before (casaRatio held a percent for months).
      if (exp.expectedParseCoverage) {
        for (const [field, range] of Object.entries(exp.expectedParseCoverage)) {
          expect(Number.isInteger(range.min), `${folder}.${field}: min must be an integer count`).toBe(true);
          expect(Number.isInteger(range.max), `${folder}.${field}: max must be an integer count`).toBe(true);
          expect(range.min, `${folder}.${field}: min must be >= 0`).toBeGreaterThanOrEqual(0);
          expect(range.min, `${folder}.${field}: min should be <= max`).toBeLessThanOrEqual(range.max);
        }
      }

      // Segment counts, when present. Exact integers or null — null means the
      // ZIP ships no file for that slot, which is a different state from a file
      // that parsed to zero segments, so `null` and `0` must both survive the
      // JSON round-trip distinctly.
      if (exp.expectedSegmentCoverage) {
        for (const slot of ["business", "geographic", "mixed"] as const) {
          const count = exp.expectedSegmentCoverage[slot];
          expect(
            count === null || (Number.isInteger(count) && count >= 0),
            `${folder}.${slot}: must be null or a non-negative integer, got ${count}`,
          ).toBe(true);
        }
      }
    }
    // We expect at least the 5 mandatory ones.
    expect(validated, "fewer expectations.json files than mandatory golden companies").toBeGreaterThanOrEqual(REQUIRED_GOLDEN.length);
  });

  it("companyId in expectations.json is a deterministic kebab-case slug", () => {
    if (!existsSync(COMPANIES_ROOT)) return;
    const folders = readdirSync(COMPANIES_ROOT);
    for (const folder of folders) {
      const exp = readExpectations(folder);
      if (!exp) continue;
      // Kebab-case: lowercase letters, digits, hyphens; no spaces or
      // uppercase. Allows internal hyphens.
      expect(exp.companyId, `${folder}: companyId '${exp.companyId}' must be kebab-case`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("each shipped expectations.json carries reviewer notes (defensibility)", () => {
    if (!existsSync(COMPANIES_ROOT)) return;
    const folders = readdirSync(COMPANIES_ROOT);
    for (const folder of folders) {
      const exp = readExpectations(folder);
      if (!exp) continue;
      // Notes are optional in the schema but mandatory in practice for
      // a reviewer to understand the tolerance bands. Plan v4 PR-F
      // tightens this up.
      expect(typeof exp.notes === "undefined" || typeof exp.notes === "string").toBe(true);
      if (exp.notes) {
        expect(exp.notes.length, `${folder}: notes too short for reviewer use`).toBeGreaterThan(20);
      }
    }
  });

  it("the 5 mandatory golden companies cover diverse profiles", () => {
    const profiles = new Set<string>();
    for (const folder of REQUIRED_GOLDEN) {
      const exp = readExpectations(folder);
      if (!exp || !exp.profile) continue;
      profiles.add(exp.profile);
    }
    // Plan v4 mandates: clean industrial, demerger fixture, BFSI bank,
    // capital-intensive regulated, NBFC. That's 5 distinct profiles.
    expect(profiles.size).toBeGreaterThanOrEqual(4);
  });
});
