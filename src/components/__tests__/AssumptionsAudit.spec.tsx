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

function render(config: EngineConfig, opts?: { pack?: boolean }) {
  const costOfCapital = resolveCostOfCapitalFromConfig({
    config,
    ...(opts?.pack ? { macroPack: INDIA_MACRO_PACK, analysisAsOf: "2026-07-27" } : {}),
  });
  return {
    html: renderToStaticMarkup(<AssumptionsAudit config={config} costOfCapital={costOfCapital} />),
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
