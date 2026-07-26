import { describe, expect, it } from "vitest";
import { buildHoldoutVintageIndex, type VintageArtifact } from "../vintageIndex";

function artifact(id: string, filingAsOf: string | null, acquiredAt: string | null = "2026-07-01T00:00:00.000Z"): VintageArtifact {
  return { artifactId: `sha256:${id}`, filingAsOf, acquiredAt };
}

describe("buildHoldoutVintageIndex", () => {
  it("classifies one snapshot covering many periods as single-export", () => {
    // The Capitaline shape: a single ZIP carrying FY19..FY24.
    const periodEnds = ["2019-03-31", "2020-03-31", "2021-03-31", "2022-03-31", "2023-03-31", "2024-03-31"];
    const index = buildHoldoutVintageIndex({
      artifacts: [artifact("zip", "2024-06-30")],
      periodArtifacts: Object.fromEntries(periodEnds.map((periodEnd) => [periodEnd, "sha256:zip"])),
    });

    expect(index.kind).toBe("single-export");
    expect(index.periods).toHaveLength(6);
    // Provenance is still recorded — it just cannot support an out-of-sample claim.
    expect(index.periods.every((period) => period.filingAsOf === "2024-06-30")).toBe(true);
  });

  it("classifies per-period artifacts carrying their own filing dates as per-filing", () => {
    const index = buildHoldoutVintageIndex({
      artifacts: [
        artifact("fy23", "2023-06-28"),
        artifact("fy24", "2024-06-27"),
      ],
      periodArtifacts: {
        "2023-03-31": "sha256:fy23",
        "2024-03-31": "sha256:fy24",
      },
    });

    expect(index.kind).toBe("per-filing");
    expect(index.periods.map((period) => period.filingAsOf)).toEqual(["2023-06-28", "2024-06-27"]);
  });

  it("withholds per-filing when any artifact has no filing date", () => {
    const index = buildHoldoutVintageIndex({
      artifacts: [artifact("fy23", "2023-06-28"), artifact("fy24", null)],
      periodArtifacts: {
        "2023-03-31": "sha256:fy23",
        "2024-03-31": "sha256:fy24",
      },
    });

    expect(index.kind).toBe("single-export");
  });

  it("returns unknown rather than guessing when there is no provenance", () => {
    expect(buildHoldoutVintageIndex({ artifacts: [], periodArtifacts: {} }).kind).toBe("unknown");
  });

  it("treats a period pointing at an absent artifact as unstamped", () => {
    const index = buildHoldoutVintageIndex({
      artifacts: [artifact("fy23", "2023-06-28")],
      periodArtifacts: {
        "2023-03-31": "sha256:fy23",
        "2024-03-31": "sha256:missing",
      },
    });

    expect(index.kind).toBe("single-export");
    expect(index.periods.find((period) => period.periodEnd === "2024-03-31")?.filingAsOf).toBeNull();
  });

  it("orders periods chronologically so filing-date monotonicity can be checked", () => {
    const index = buildHoldoutVintageIndex({
      artifacts: [artifact("b", "2024-06-27"), artifact("a", "2023-06-28")],
      periodArtifacts: {
        "2024-03-31": "sha256:b",
        "2023-03-31": "sha256:a",
      },
    });

    expect(index.periods.map((period) => period.periodEnd)).toEqual(["2023-03-31", "2024-03-31"]);
  });
});
