/* ================================================================
   Assumptions Audit — provenance contract.

   This panel is the reviewer's answer to "where did each number come
   from?", so a wrong source badge is worse than a missing one. It had
   no spec while it reported `config.ke` — a rate the valuation does not
   discount at — and badged engine defaults as "User".

   The cost-of-capital results below come from the real resolver rather
   than hand-built literals, so the spec cannot drift from what the
   engine would actually hand this panel.
================================================================ */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AssumptionsAudit, { sourceBadge } from "../AssumptionsAudit";
import { DEFAULT_CONFIG, type EngineConfig } from "../../engine/types";
import { PercentFraction } from "../../engine/types/units";
import { resolveCostOfCapitalFromConfig } from "../../engine/costOfCapital";
import { INDIA_MACRO_PACK } from "../../engine/marketPacks/indiaMacroPack";

/**
 * 4% is what the app actually reaches this panel with — `ValuationReport`'s g
 * state defaults to 4.0 and the base scenario's clamped growth lands in the same
 * region. Deliberately NOT 5%: that is the `?? 0.05` fallback the row used to
 * print, so a default of 5% here would let the old behaviour pass the new tests.
 */
const RUN_G = 0.04;

function render(config: EngineConfig, opts?: { pack?: boolean; terminalGrowth?: number | null }) {
  const costOfCapital = resolveCostOfCapitalFromConfig({
    config,
    ...(opts?.pack ? { macroPack: INDIA_MACRO_PACK, analysisAsOf: "2026-07-27" } : {}),
  });
  const terminalGrowth = opts && "terminalGrowth" in opts ? opts.terminalGrowth ?? null : RUN_G;
  return {
    html: renderToStaticMarkup(
      <AssumptionsAudit config={config} costOfCapital={costOfCapital} terminalGrowth={terminalGrowth} />,
    ),
    costOfCapital,
  };
}

describe("AssumptionsAudit — ke agreement", () => {
  it("shows the resolved ke, not a reviewer-typed config.ke the run ignored", () => {
    // ConfigSection writes `config.ke`, but the app never sets
    // `cost_of_equity_mode`, so it stays "capm" and this 18% is not the
    // discount rate. The panel used to print it anyway.
    const config: EngineConfig = { ...DEFAULT_CONFIG, ke: PercentFraction(0.18), company_type: "it-services" };
    const { html, costOfCapital } = render(config);

    expect(costOfCapital.ke).toBeCloseTo(0.121, 6);
    expect(html).toContain("12.1%");
    expect(html).not.toContain("18.0%");
  });

  it("labels ke by its weakest input, not by the strongest", () => {
    // rf and ERP are sourced from the pack; beta is still a sector prior with
    // no pack or peer set. A ke resting on that beta is a prior.
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "consumer" };
    const { html, costOfCapital } = render(config, { pack: true });

    expect(costOfCapital.assumptions?.riskFreeRate.tier).toBe("sourced");
    expect(costOfCapital.assumptions?.beta.tier).toBe("prior");
    // "Sourced" still appears (the rf row), so assert the count of Prior
    // badges rather than mere presence.
    expect(html.match(/>Prior</g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("reports manual ke as the reviewer's, with no invented tier", () => {
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      cost_of_equity_mode: "manual",
      ke: PercentFraction(0.155),
      ke_manual_rationale: "Reviewer judgment",
    };
    const { html, costOfCapital } = render(config);

    expect(costOfCapital.ke).toBeCloseTo(0.155, 6);
    expect(html).toContain("15.5%");
    // Manual ke multiplies no ERP and no beta; saying so beats printing the
    // config constants the run never used.
    expect(html).toContain("Not used (manual ke)");
    expect(html).not.toContain("Sourced");
    expect(html).not.toContain("Prior");
  });
});

describe("AssumptionsAudit — source badges", () => {
  it("does not badge engine defaults as a reviewer's choice", () => {
    // Every one of these fields is required on EngineConfig, so the old
    // `!= null` tests were always true and every row read "User".
    const { html } = render(DEFAULT_CONFIG);
    expect(html).not.toContain(">User<");
  });

  it("treats company_type 'auto' as unset", () => {
    const auto = render({ ...DEFAULT_CONFIG, company_type: "auto" }).html;
    expect(auto).toContain("Auto-detection may misclassify");
    expect(auto).toContain(">Default<");

    const explicit = render({ ...DEFAULT_CONFIG, company_type: "it-services" }).html;
    expect(explicit).not.toContain("Auto-detection may misclassify");
    expect(explicit).toContain(">User<");
  });

  it("gives every provenance level its own colour", () => {
    // Two badges shipped sharing a colour with a stronger tier: Computed with
    // Sourced, and Estimated with User. Identical styling in the one panel whose
    // job is telling provenance apart is a silent failure — a reviewer skimming
    // colours reads a derived number as an observed one.
    const levels = ["user", "default", "computed", "sourced", "estimated", "prior"] as const;
    const badges = levels.map(l => sourceBadge(l));

    expect(new Set(badges.map(b => b.text)).size).toBe(levels.length);
    expect(new Set(badges.map(b => b.cls)).size).toBe(levels.length);
  });

  it("surfaces why a beta fell back to its sector prior", () => {
    const { html, costOfCapital } = render({ ...DEFAULT_CONFIG, company_type: "nbfc" });
    const reason = costOfCapital.assumptions?.beta.fallbackReason;

    expect(reason).toBeTruthy();
    // The reviewer sees the resolver's own reason, not a generic warning.
    expect(html).toContain("usable peer beta");
    expect(html).toContain("1.30×");
  });
});

describe("AssumptionsAudit — terminal growth agreement", () => {
  // Same defect the ke row was fixed for: the row read a config field, and the
  // run discounted at a different number. `config.terminal_growth_rate` has no
  // writer anywhere in the app — absent from DEFAULT_CONFIG, no UI control, no
  // company data file — so it was always undefined and the row always printed
  // the 5% fallback with a "Default" badge.

  it("shows the run's terminal growth, not the 5% config fallback", () => {
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "it-services" };
    const { html, costOfCapital } = render(config);

    expect(costOfCapital.ke).toBeCloseTo(0.121, 6);
    expect(html).toContain("4.0%");
    // The spread row has to move with it. 12.1% − 4% = 8.1%; the old pairing of
    // a resolved ke with the 5% fallback gave 7.1%, so its absence is what
    // catches a regression in the spread leg specifically.
    expect(html).toContain("8.1%");
    expect(html).not.toContain("7.1%");
  });

  it("ignores config.terminal_growth_rate even when something sets it", () => {
    // Nothing in the app writes this field today, but a future caller might,
    // and it still would not be the growth any model applied. The panel reports
    // the run, not the config.
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      company_type: "it-services",
      terminal_growth_rate: 0.09,
    };
    const { html } = render(config);

    expect(html).toContain("4.0%");
    expect(html).not.toContain("9.0%");
  });

  it("badges the growth Computed, not the reviewer's choice", () => {
    // `g_terminal_override` is clamped to the sector template's floor and cap
    // before any model sees it (valuationCommandCenter/builders.ts:186-190), so
    // the number on this row can differ from the one a reviewer typed. "User"
    // would overstate what the reviewer actually controlled.
    const { html } = render({ ...DEFAULT_CONFIG, company_type: "it-services" });
    const growthRow = html.slice(html.indexOf("Terminal Growth (g)"));

    expect(growthRow.slice(0, 400)).toContain(">Computed<");
    expect(growthRow.slice(0, 400)).not.toContain(">Default<");
  });

  it("says the growth is unresolved rather than inventing one", () => {
    // No base scenario means no growth was applied. Printing 5.0% here is the
    // exact failure this panel exists to prevent, and a blank row reads as a
    // surface that was never wired up.
    const { html } = render({ ...DEFAULT_CONFIG, company_type: "it-services" }, { terminalGrowth: null });

    // Twice: the growth row and the spread that depends on it.
    expect(html.match(/Not resolved/g)?.length).toBe(2);
    expect(html).not.toContain("4.0%");
    expect(html).toContain("cannot be reproduced from this panel");
  });

  it("can finally flag a real g ≥ ke breach", () => {
    // Unreachable before: the flag tested the never-written config field, so it
    // could not fire on a real breach and could fire spuriously on a low ke.
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      cost_of_equity_mode: "manual",
      ke: PercentFraction(0.035),
      ke_manual_rationale: "Reviewer judgment",
    };
    const { html } = render(config);

    expect(html).toContain("g ≥ ke breaks the Gordon Growth model");
    expect(html).toContain("🛑");
    expect(html).toContain("1 error");
  });

  it("does not flag a breach when the spread is healthy", () => {
    // Positive control for the test above: same manual-ke path, ke well clear
    // of g, so the error must be absent rather than merely differently worded.
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      cost_of_equity_mode: "manual",
      ke: PercentFraction(0.14),
      ke_manual_rationale: "Reviewer judgment",
    };
    const { html } = render(config);

    expect(html).not.toContain("g ≥ ke breaks the Gordon Growth model");
    expect(html).not.toContain("1 error");
  });
});
