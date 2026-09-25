/* ================================================================
   End-to-end pin for the assumption-provenance gate's PRODUCTION-READY
   DOWNGRADE — the gap in `analysisTraceability.spec.ts`.

   Why this lives in the app hook, not the engine: the engine-side spec cannot
   reach the `production-ready` rigor checkpoint with a synthetic recast fixture
   — the dummy raw metrics trip `conceptIdentity` ("6 unresolved critical
   conflicts"), and even `sectorLadderCap.spec.ts`'s purpose-built balanced
   fixture can't rely on reaching valuation-eligible (documented at :146-150).
   A synthetic fixture therefore either never exercises the gate, or does so on
   a path no real run takes — which is why this is asserted through
   `useAuditAnalysis`, where the golden fixture drives a real command center.

   What is pinned here is the APP wiring: the manual-ke provenance must reach
   the shared envelope, while a more fundamental reconciliation failure remains
   the production-ready headline. The engine-side provenance spec covers the
   gate's isolated effect; this test prevents the app hook from dropping the
   signal that gate consumes.

     - The fixture is intentionally the real VST sample used by the app's
       provenance spec. It is structurally unreconciled, so production-ready is
       expected to stop at the lower rung rather than let the provenance reason
       mask the reconciliation failure.
     - A MANUAL ke (`cost_of_equity_mode: "manual"`, `ke: 0.155`) resolves no
       CAPM term at all, so `buildAssumptionProvenance` reports `cost-of-equity`
       as a prior instead of `absent`. If the hook drops the command center's
       provenance or stops passing manual mode to the helper, this test fails.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useAuditAnalysis, type AuditAnalysisInputs } from "../useAuditAnalysis";
import { vstRealCompanySample } from "../../engine/goldenCompanySuite/fixtures";
import { DEFAULT_CONFIG, type CompanyRegistry } from "../../engine/types";
import { PercentFraction } from "../../engine/types/units";
import type { AnalysisRigorCheckpoint } from "../../engine/analysisTraceability";
import type { AssumptionProvenanceSummary } from "../../engine/types/assumptionProvenance";

const EMPTY_REGISTRY: CompanyRegistry = { companies: {} };

function inputs(over: Partial<AuditAnalysisInputs> = {}): AuditAnalysisInputs {
  return {
    rawData: vstRealCompanySample,
    standaloneRawData: null,
    config: { ...DEFAULT_CONFIG },
    bankQuality: null,
    debugInfo: null,
    parserDiagnostics: null,
    auditMeta: null,
    registry: EMPTY_REGISTRY,
    ...over,
  };
}

/** Runs the hook once and hands back what the App shell would consume. */
function runHook(over: Partial<AuditAnalysisInputs> = {}) {
  let captured: ReturnType<typeof useAuditAnalysis> | null = null;
  function Probe() {
    captured = useAuditAnalysis(inputs(over));
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (captured === null) throw new Error("probe never rendered");
  return captured as ReturnType<typeof useAuditAnalysis>;
}

function readGate(result: ReturnType<typeof useAuditAnalysis>) {
  const checkpoints = result.traceability.rigor.checkpoints as AnalysisRigorCheckpoint[];
  const production = checkpoints.find((c) => c.level === "production-ready");
  const achieved = (result.traceability.rigor.achievedLevels as string[]).includes(
    "production-ready",
  );
  return { production, achieved };
}

describe("useAuditAnalysis — ke provenance gate end-to-end (production-ready downgrade)", () => {
  it("with a manual ke, the provenance gate denies production-ready and names cost-of-equity", () => {
    // The reachable bypass: a reviewer types a discount rate, no CAPM terms
    // resolve, and the old code reported `absent` — which does not fire the
    // gate. The gate now lists `cost-of-equity`, so the manual path must not
    // reach the final rung.
    const result = runHook({
      config: { ...DEFAULT_CONFIG, cost_of_equity_mode: "manual", ke: PercentFraction(0.155) },
    });

    // Guard the guard: without this the negative assertions below are true of
    // a run that never valued anything at all, which proves nothing about the
    // gate.
    expect(result.engineError).toBeNull();
    expect(result.recastData?.length ?? 0).toBeGreaterThanOrEqual(2);
    const prov = result.traceability.assumptionProvenance as AssumptionProvenanceSummary;
    expect(prov).toBeTruthy();
    expect(prov.priorTierKeys).toContain("cost-of-equity");

    const { production, achieved } = readGate(result);
    expect(achieved).toBe(false);
    expect(production?.achieved).toBe(false);
    // The lower-rung reconciliation reason must remain visible; the app should
    // not replace it with a provenance explanation when the gate was never
    // otherwise eligible to rewrite the checkpoint.
    expect(production?.detail).toMatch(/reconciliation/i);
    expect(production?.detail).not.toMatch(/cost-of-equity/);
  });

  it("without a manual ke, no cost-of-equity prior is reported", () => {
    // The contrast case: the same fixture on its default CAPM path. It either
    // reports a defensible block or a `beta` prior — never `cost-of-equity` —
    // so the downgrade above cannot be explained by the fixture always
    // carrying the manual marker.
    const result = runHook();

    expect(result.engineError).toBeNull();
    const prov = result.traceability.assumptionProvenance as AssumptionProvenanceSummary;
    expect(prov.priorTierKeys).not.toContain("cost-of-equity");
  });
});
