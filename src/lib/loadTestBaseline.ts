/* ================================================================
   Plan 9 PR-9.4 — Load test baseline gate (pure logic).

   Pure helpers used by both the k6 script (via k6's k6/options
   thresholds) and CI to compare a measured run against the
   baseline. Decoupled so the baseline file is the single source
   of truth and the comparison logic is testable.

   API:
     loadBaseline(json)                        -> Baseline
     compareToBaseline(measured, baseline, gate) -> RegressionReport

   Why pure logic:
     - The k6 script can run anywhere; reporting / gating is local
     - CI can fail a PR by parsing the k6 summary and calling this
     - Tests can construct synthetic measurements without running k6
================================================================ */

export interface EndpointBaseline {
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  errorRate: number;
  notes?: string;
}

export interface Baseline {
  version: string;
  measuredOn: string;
  environment: string;
  endpoints: Record<string, EndpointBaseline>;
  regressionGate: {
    p95RegressionThreshold: number;
    errorRateRegressionThreshold: number;
    policy: string;
  };
}

export interface MeasuredEndpoint {
  endpoint: string;
  p95_ms: number;
  errorRate: number;
}

export interface RegressionReport {
  passed: boolean;
  failures: {
    endpoint: string;
    metric: "p95" | "errorRate";
    measured: number;
    baseline: number;
    threshold: number;
    reason: string;
  }[];
}

export function loadBaseline(json: string | object): Baseline {
  return typeof json === "string"
    ? (JSON.parse(json) as Baseline)
    : (json as Baseline);
}

export function compareToBaseline(
  measured: MeasuredEndpoint[],
  baseline: Baseline,
): RegressionReport {
  const failures: RegressionReport["failures"] = [];
  const p95Mult = baseline.regressionGate.p95RegressionThreshold;
  const errorAbs = baseline.regressionGate.errorRateRegressionThreshold;

  for (const m of measured) {
    const b = baseline.endpoints[m.endpoint];
    if (!b) continue; // unknown endpoints skip

    if (m.p95_ms > b.p95_ms * p95Mult) {
      failures.push({
        endpoint: m.endpoint,
        metric: "p95",
        measured: m.p95_ms,
        baseline: b.p95_ms,
        threshold: b.p95_ms * p95Mult,
        reason: `p95 ${m.p95_ms}ms exceeds baseline ${b.p95_ms}ms × ${p95Mult} = ${(b.p95_ms * p95Mult).toFixed(0)}ms`,
      });
    }

    if (m.errorRate > errorAbs) {
      failures.push({
        endpoint: m.endpoint,
        metric: "errorRate",
        measured: m.errorRate,
        baseline: b.errorRate,
        threshold: errorAbs,
        reason: `Error rate ${(m.errorRate * 100).toFixed(2)}% exceeds gate ${(errorAbs * 100).toFixed(2)}%`,
      });
    }
  }

  return { passed: failures.length === 0, failures };
}
