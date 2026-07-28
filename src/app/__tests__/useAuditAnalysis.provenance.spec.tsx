/* ================================================================
   P3 — live-app wiring of the assumption-provenance block.

   The gate itself is covered by engine/__tests__/assumptionProvenance.spec.ts.
   What that spec cannot see is whether the APP reaches it: the hook used to
   build a full valuation command center and keep only `valuationTriangulation`,
   so the provenance gate fired in the run executor but never in the UI.

   `useAuditAnalysis` is pure `useMemo` over its inputs — no state, no effects —
   so a probe component rendered through `renderToStaticMarkup` exercises the
   real derivation chain without a hook-testing dependency.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useAuditAnalysis, type AuditAnalysisInputs } from "../useAuditAnalysis";
import { vstRealCompanySample } from "../../engine/goldenCompanySuite/fixtures";
import { DEFAULT_CONFIG, type CompanyRegistry } from "../../engine/types";
import type { AssumptionProvenanceSummary } from "../../engine/types";

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

describe("useAuditAnalysis — assumption provenance reaches the envelope", () => {
  it("recasts the fixture, so the assertions below are not vacuous", () => {
    const result = runHook();

    expect(result.engineError).toBeNull();
    expect(result.recastData?.length ?? 0).toBeGreaterThan(0);
  });

  it("publishes a provenance block on the envelope the UI reads", () => {
    const provenance = runHook().traceability.assumptionProvenance;

    // The regression this spec exists for: before the fix this was undefined
    // because the hook discarded the command center's costOfCapital.
    expect(provenance).not.toBeUndefined();
    expect(provenance).not.toBeNull();
    const block = provenance as AssumptionProvenanceSummary;
    expect(block.checks.map((check) => check.key).sort()).toEqual([
      "beta",
      "equity-risk-premium",
      "risk-free-rate",
      "terminal-growth-ceiling",
    ]);
  });

  it("reports the pack's dated inputs as sourced and the rest as priors", () => {
    // This asserted `prior-dependent` until the packs were activated: nothing in
    // the app supplied one, so every CAPM input rested on a config constant.
    // `useAuditAnalysis` now passes `ACTIVE_MARKET_PACKS`, so the risk-free rate
    // and ERP carry observation dates and the status is `mixed`.
    //
    // Both remaining priors are structural, not oversights, which is why this
    // asserts `mixed` rather than being relaxed to accept anything:
    //   - beta, because this fixture's config carries no `ticker` and the beta
    //     pack is keyed by exchange ticker. A manual upload sits in exactly this
    //     position, so reporting a prior there is the honest reading.
    //   - terminal-growth-ceiling, because `INDIA_MACRO_PACK` pins
    //     `longRunNominalGrowth` to null on purpose.
    const block = runHook().traceability.assumptionProvenance as AssumptionProvenanceSummary;

    expect(block.status).toBe("mixed");
    expect(block.priorTierKeys).toContain("beta");
    // The activation itself: these two were priors before it and must not
    // regress to priors while a pack is being supplied.
    expect(block.priorTierKeys).not.toContain("risk-free-rate");
    expect(block.priorTierKeys).not.toContain("equity-risk-premium");
  });

  it("resolves the beta too once the config names a ticker the pack covers", () => {
    // The other half of the same wiring, and the case a library-loaded company
    // actually hits — AppShell sets `config.ticker` from the ingested company id,
    // which is the registry ticker. Without this, the assertion above would pass
    // just as well if the beta pack were never supplied at all.
    const block = runHook({ config: { ...DEFAULT_CONFIG, ticker: "TCS" } })
      .traceability.assumptionProvenance as AssumptionProvenanceSummary;

    expect(block.priorTierKeys).not.toContain("beta");
  });

  it("does not let the provenance reason mask a more fundamental failure", () => {
    // This fixture is already blocked at structurally-reconciled, so its
    // production-ready checkpoint fails for a lower-rung reason. The gate only
    // rewrites a checkpoint that is otherwise achieved — a reviewer must see the
    // reconciliation breach, not a discount-rate footnote, as the headline.
    const rigor = runHook().traceability.rigor;

    expect(rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = rigor.checkpoints.find((item) => item.level === "production-ready");
    expect(checkpoint?.achieved).toBe(false);
    expect(checkpoint?.detail).toMatch(/reconciliation/i);
    expect(checkpoint?.detail).not.toMatch(/undated priors/);
  });

  it("reports no provenance when there is nothing to analyse", () => {
    const result = runHook({ rawData: null });

    expect(result.recastData).toBeNull();
    // Null, not a defensible-looking empty block.
    expect(result.traceability.assumptionProvenance ?? null).toBeNull();
  });
});
