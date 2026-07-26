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
        // (e) Anomaly flags — every expected flag must appear in the
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
