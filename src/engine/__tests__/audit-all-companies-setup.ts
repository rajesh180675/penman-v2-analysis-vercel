import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { it, expect } from "vitest";
import {
  auditCompanyRun,
  type AuditCompanyRunResult,
  type AuditRegistryEntry,
} from "../../../scripts/lib/auditCompanyRun";

const PROJECT_ROOT = resolve(__dirname, "../../..");
const COMPANIES_DIR = resolve(PROJECT_ROOT, "public/data/companies");
const REGISTRY_PATH = join(COMPANIES_DIR, "registry.json");
const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as AuditRegistryEntry[];

interface ExpectationsContract {
  companyId: string;
  companyName: string;
  expectedRigorLevel: string;
  expectedParserFidelityStatus: string;
  expectedReconciliationStatus: string;
  expectedEconomicSanityStatus: string;
  expectedConceptIdentityStatus: string;
  keyMetricTolerances: Record<string, { min: number; max: number }>;
  expectedAnomalyFlags: string[];
  expectedUnusualItemCount: { min: number; max: number };
  expectedRunsCleanWorkbook: boolean;
  /**
   * How much the parser produced, banded ±25% by `refresh-expectations`.
   *
   * Optional so a contract written before this field existed still gates on
   * everything else rather than throwing. Every field above describes the
   * *shape* of a run, and a parse can lose most of its metrics without moving
   * any of them: TCS fell from 4407 metric keys to 475 and 60425 values to
   * 6499 while still reporting 15 clean periods, unchanged ratios, and the
   * same parser-fidelity status — the whole gate stayed green.
   */
  expectedParseCoverage?: {
    metricKeyCount: { min: number; max: number };
    nonNullValueCount: { min: number; max: number };
  };
  /**
   * Segments per slot, captured exactly rather than banded.
   *
   * `expectedParseCoverage` above cannot see any of this — segment files are
   * routed to a separate `segmentData` channel, not into `raw_metric_values` —
   * and SOTP depends on it through a threshold: `buildSotpAssessment` runs only
   * at `segments.length >= 2`. NTPC sits at exactly 2.
   *
   * null is legitimate (Bajaj Finance ships no segment files), so this asserts
   * equality, not presence.
   */
  expectedSegmentCoverage?: {
    business: number | null;
    geographic: number | null;
    mixed: number | null;
  };
  notes?: string;
}

type TestAuditResult = AuditCompanyRunResult & { hasExpectations: boolean };

function readExpectations(folder: string): ExpectationsContract | null {
  const p = join(COMPANIES_DIR, folder, "expectations.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as ExpectationsContract;
}

export function createAuditTests({ start, size }: { start: number; size: number }) {
  const slice = registry.slice(start, start + size);
  const results: TestAuditResult[] = [];

  for (const company of slice) {
    const expectations = readExpectations(company.folder);
    const expectationsLabel = expectations ? " [expectations gate]" : "";

    it(`${company.folder} (${company.ticker}) — valuation is valid${expectationsLabel}`, async () => {
      const result = await auditCompany(company);
      results.push(result);

      // Pipeline crash always fails.
      if (result.flags.some((f) => f.startsWith("ERROR") || f.startsWith("CALC_ERROR"))) {
        expect(result.flags, `pipeline crashed: ${result.error}`).toEqual([]);
      }

      // Universal weak gates — apply to all companies.
      // Industrial path produces RecastPeriod[]; financial-institution path
      // produces BankPeriodMetrics[]. Both surface a periods count.
      expect(result.periods).toBeGreaterThanOrEqual(2);
      expect(result.companyType).toBe(company.type);
      expect(result.analysisFamily).not.toBe("unknown");
      expect(result.pipelineStrategyId).toBeTruthy();
      expect(result.statusClass).not.toBe("calc-error");

      // Scenario gates apply only to the industrial path. Bank/NBFC/insurance
      // valuations live under bankResult.valuation, not industrial scenarios.
      if (result.analysisFamily === "industrial") {
        expect(result.stress).not.toBeNull();
        expect(result.base).not.toBeNull();
        expect(result.modelApplicability.industrialCommandCenter.status).not.toBe("skipped");
      } else if (result.analysisFamily === "financial-institution") {
        expect(result.modelApplicability.industrialCommandCenter.status).toBe("skipped");
        expect(result.modelApplicability.financialInstitutionValuation.status).not.toBe("skipped");
      }

      // Strict gates — apply only when expectations.json is present.
      // This is the regression gate: ratio sign flips, parser status drift,
      // reconciliation drift, terminal-valuation drift, and missing anomaly
      // flags would all be caught here.
      if (expectations) {
        // (a) Rigor level matches
        if (result.rigorLevel) {
          expect(
            result.rigorLevel,
            `rigor level drift: expected "${expectations.expectedRigorLevel}", got "${result.rigorLevel}"`,
          ).toBe(expectations.expectedRigorLevel);
        }
        // (b) Parser fidelity status
        if (result.parserFidelityStatus) {
          expect(
            result.parserFidelityStatus,
            `parser fidelity drift: expected "${expectations.expectedParserFidelityStatus}"`,
          ).toBe(expectations.expectedParserFidelityStatus);
        }
        // (c) Reconciliation status
        if (result.reconciliationStatus) {
          expect(
            result.reconciliationStatus,
            `reconciliation status drift: expected "${expectations.expectedReconciliationStatus}"`,
          ).toBe(expectations.expectedReconciliationStatus);
        }
        // (d) keyMetricTolerances — assert each metric is within band
        for (const [metric, band] of Object.entries(expectations.keyMetricTolerances)) {
          const value = result.metrics[metric as keyof typeof result.metrics];
          if (value == null || !Number.isFinite(value)) {
            throw new Error(`metric "${metric}" expected in [${band.min}, ${band.max}] but value is ${value}`);
          }
          expect(value, `${metric} out of band [${band.min}, ${band.max}]: got ${value}`)
            .toBeGreaterThanOrEqual(band.min);
          expect(value, `${metric} out of band [${band.min}, ${band.max}]: got ${value}`)
            .toBeLessThanOrEqual(band.max);
        }
        // (e) Parse coverage — how much came out of the parser at all.
        // Bands are wide (±25%); anything tripping this is a cliff, not drift,
        // so report the direction rather than leaving a bare number comparison.
        const coverageBands = expectations.expectedParseCoverage;
        if (coverageBands) {
          const observed: Record<string, number> = {
            metricKeyCount: result.parseCoverage.metricKeyCount,
            nonNullValueCount: result.parseCoverage.nonNullValueCount,
          };
          for (const [field, band] of Object.entries(coverageBands)) {
            const value = observed[field]!;
            const direction = value < band.min ? "COLLAPSED" : "GREW";
            expect(
              value,
              `parse coverage ${direction}: ${field} ${value} is outside [${band.min}, ${band.max}]. ` +
              `The parser is extracting a different amount of data than when this baseline was captured — ` +
              `check the grid strategy and cell cleaning before regenerating.`,
            ).toBeGreaterThanOrEqual(band.min);
            expect(
              value,
              `parse coverage ${direction}: ${field} ${value} is outside [${band.min}, ${band.max}].`,
            ).toBeLessThanOrEqual(band.max);
          }
        }
        // (f) Segment coverage — exact counts per slot, because SOTP turns on a
        // threshold (>= 2 segments) rather than degrading smoothly, and these
        // are single-digit numbers where a band would swallow the whole signal.
        const segmentExpectation = expectations.expectedSegmentCoverage;
        if (segmentExpectation) {
          for (const [slot, expectedCount] of Object.entries(segmentExpectation)) {
            const actual = result.segmentCoverage[slot as keyof typeof result.segmentCoverage];
            expect(
              actual,
              `segment coverage drift: ${slot} was ${expectedCount} at capture, now ${actual}. ` +
              `Segment data feeds SOTP (needs >= 2 segments) and the dashboard breakdown; ` +
              `null means the ZIP ships no such file, so a number-to-null change means extraction broke.`,
            ).toBe(expectedCount);
          }
        }
        // (g) Anomaly flags — every expected flag must appear in the
        // observed set (subset check; observed may legitimately include
        // additional minor flags without failing the gate).
        if (expectations.expectedAnomalyFlags.length > 0) {
          for (const expectedFlag of expectations.expectedAnomalyFlags) {
            expect(
              result.anomalyFlagKeys,
              `expected anomaly flag "${expectedFlag}" not raised by pipeline`,
            ).toContain(expectedFlag);
          }
        }
      }
    }, 120_000);
  }

  it("print shard summary", () => {
    const errorResults = results.filter((r) => r.flags.length);
    const okResults = results.filter((r) => !r.flags.length);
    const gatedResults = results.filter((r) => r.hasExpectations);

    console.log(
      `\n[Shard ${start}-${start + size}] ` +
      `${okResults.length}/${results.length} clean, ` +
      `${errorResults.length} flagged, ` +
      `${gatedResults.length} with expectations.json (strict gate)`,
    );

    for (const r of errorResults) {
      console.log(`  ${r.folder} (${r.ticker}): ${r.flags.join(", ")}`);
    }
  });
}

async function auditCompany(company: AuditRegistryEntry): Promise<TestAuditResult> {
  const hasExpectations = existsSync(join(COMPANIES_DIR, company.folder, "expectations.json"));
  const result = await auditCompanyRun(company, { projectRoot: PROJECT_ROOT });
  return { ...result, hasExpectations };
}
