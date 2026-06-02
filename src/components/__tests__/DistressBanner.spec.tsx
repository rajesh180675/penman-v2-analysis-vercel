import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DistressBanner from "../valuation/DistressBanner";
import type { DistressAssessment } from "../../engine/distressDetector";

function dmartLeaseArtifactWarning(): DistressAssessment {
  return {
    hasNegativeEquity: true,
    negativeEquityPeriods: 4,
    totalPeriods: 14,
    latestCSENegative: false,
    latestCSE: 21_427.75,
    latestNFO: -53.02,
    latestCFO: 2_462.97,
    runwayYearsAtCFOBurn: null,
    severity: "warning",
    equityModelsBlocked: false,
    reasons: [
      "4 historical negative-equity period(s) detected (longest run 4), but latest equity is positive; treat as an accounting/structural-break caveat, not current financial distress.",
      "Latest CFO is positive, so historical negative equity is not a current cash-burn insolvency signal.",
      "Latest NFO is near net-cash; lease accounting and structural breaks explain the historical balance-sheet caveat better than credit stress.",
    ],
  };
}

describe("DistressBanner", () => {
  it("labels DMART-shaped recovered lease-accounting artifacts as non-current distress", () => {
    const html = renderToStaticMarkup(<DistressBanner distress={dmartLeaseArtifactWarning()} />);

    expect(html).toContain("Historical accounting caveat — not current distress");
    expect(html).toContain("latest equity is positive");
    expect(html).toContain("Latest CFO is positive");
    expect(html).not.toContain("Critical financial distress");
    expect(html).not.toContain("Current negative net worth");
    expect(html).not.toContain("equity-side valuation skipped");
    expect(html.toLowerCase()).not.toContain("bankruptcy");
    expect(html.toLowerCase()).not.toContain("avoid");
  });
});
