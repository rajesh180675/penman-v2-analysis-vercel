import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { it, expect } from "vitest";
import {
  auditCompanyRun,
  type AuditCompanyRunResult,
  type AuditRegistryEntry,
} from "../../../scripts/lib/auditCompanyRun";
import { tileShard } from "../../../scripts/lib/auditShards";

const PROJECT_ROOT = resolve(__dirname, "../../..");
const COMPANIES_DIR = resolve(PROJECT_ROOT, "public/data/companies");
const REGISTRY_PATH = join(COMPANIES_DIR, "registry.json");
const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as AuditRegistryEntry[];

/**
 * Companies allowed to report `statusClass === "model-gap"`, keyed by ticker,
 * valued by the reason.
 *
 * Empty, and that is the finding rather than an oversight: an audit of all 33
 * companies returns exactly one flag each, always `POLICY:RIGOR_CAP_SYNTACTIC`
 * or `POLICY:RIGOR_CAP_STRUCTURAL`. Since `auditCompanyRun` only pushes a
 * `POLICY:` flag when no other flag was raised, that single flag proves every
 * other category is empty — no `MODEL_GAP:*`, no `NO_SCENARIOS`, no
 * `*_INVALID`. So the gate this list guards costs nothing today and exists to
 * make a future regression fail loudly instead of printing into a summary
 * nobody reads.
 *
 * Add an entry only for a gap that is genuinely expected — data a ZIP does not
 * ship, a model that does not apply to a sector — and say which, so the next
 * reader can tell an accepted limitation from a bug that was waved through.
 */
const MODEL_GAP_ALLOWLIST: Record<string, string> = {};

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

/**
 * The tests for one CI shard, with its slice derived from the live registry
 * length rather than written into the spec.
 *
 * The shard specs used to pass literal `{ start, size }` pairs, and they tiled
 * 0-31 while the registry held 33 entries — so the last company was audited by
 * no shard, in a suite whose whole purpose is that every company is audited.
 * Nothing failed, because a shard that covers less than it claims is
 * indistinguishable from one that covers everything.
 */
export function createShardAuditTests(shard: number) {
  return createAuditTests(tileShard(shard, registry.length));
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
      // `model-gap` was the one actionable outcome nothing asserted against.
      //
      // Worth being precise about what this adds, because most of the flag
      // vocabulary is already gated and it is not obvious which parts:
      // `deriveAuditOutcome` maps any `ERROR`/`CALC_ERROR` prefix *and any
      // `_INVALID` suffix* to `CALC_ERROR`, so the whole `*_INVALID` cluster —
      // industrial scenarios and all six `pushInvalidIfComputed` bank labels —
      // already fails on the line above. What fell through was everything
      // mapping to `MODEL_GAP`: the `MODEL_GAP:*` flags, `NO_SCENARIOS`, and a
      // run that computed no value at all. On the financial-institution path
      // that gap was direct: `MODEL_GAP:NO_FINANCIAL_VALUATION` sets
      // `financialInstitutionValuation.status` to `"model-gap"`, and the branch
      // below only asserts it is not `"skipped"`.
      //
      // `policy-warning` stays allowed. Every one of the 33 companies reports
      // exactly one `POLICY:RIGOR_CAP_*` flag, so gating that would fail the
      // entire suite rather than catch anything.
      if (!(company.ticker in MODEL_GAP_ALLOWLIST)) {
        expect(
          result.statusClass,
          `${company.ticker} reports a model gap: ${result.flags.join(", ") || "(no flags; computed no value)"}. ` +
          `A company in the registry is expected to produce its family's models. If this gap is legitimate ` +
          `— data the ZIP does not ship, a model that genuinely does not apply — record it in ` +
          `MODEL_GAP_ALLOWLIST with the reason rather than relaxing this assertion.`,
        ).not.toBe("model-gap");
      }

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
        //
        // Only an absent key skips this. An explicit `null` container fails:
        // "no segment data" is three null slots, and a null container would
        // otherwise read as absent and quietly un-gate the company. Iterating a
        // fixed slot list rather than the contract's own keys means a contract
        // that omits a slot fails on undefined instead of leaving it unasserted.
        const segmentExpectation: unknown = expectations.expectedSegmentCoverage;
        if (segmentExpectation !== undefined) {
          expect(
            typeof segmentExpectation === "object" && segmentExpectation !== null && !Array.isArray(segmentExpectation),
            `expectedSegmentCoverage must be an object carrying business/geographic/mixed, got ` +
            `${segmentExpectation === null ? "null" : typeof segmentExpectation}. A company whose ZIP ships ` +
            `no segment files carries three null slots, not a null container.`,
          ).toBe(true);
          const slots = segmentExpectation as Record<string, number | null | undefined>;
          for (const slot of ["business", "geographic", "mixed"] as const) {
            const expectedCount = slots[slot];
            const actual = result.segmentCoverage[slot];
            expect(
              actual,
              `segment coverage drift: ${slot} was ${String(expectedCount)} at capture, now ${String(actual)}. ` +
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
