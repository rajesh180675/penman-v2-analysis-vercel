import { describe, expect, it } from "vitest";
import {
  BETA_STALENESS_DAYS,
  MAX_BETA_STANDARD_ERROR,
  MIN_BETA_OBSERVATIONS,
  resolveEquityBeta,
  type EquityBetaObservation,
  type EquityBetaPack,
} from "../equityBetaPack";

function observation(overrides: Partial<EquityBetaObservation> = {}): EquityBetaObservation {
  return {
    ticker: "TESTCO",
    leveredBeta: 1.02,
    standardError: 0.067,
    rSquared: 0.474,
    observations: 260,
    windowStart: "2021-08-01",
    windowEnd: "2026-07-19",
    ...overrides,
  };
}

function pack(overrides: Partial<EquityBetaPack> = {}): EquityBetaPack {
  return {
    asOf: "2026-07-19",
    benchmark: "NIFTY 50 (^NSEI)",
    frequency: "weekly",
    source: "Yahoo Finance adjusted-close history",
    constituents: [observation()],
    ...overrides,
  };
}

describe("resolveEquityBeta", () => {
  it("returns the regressed beta with its diagnostics when the estimate is precise enough", () => {
    const result = resolveEquityBeta(pack(), "TESTCO", { analysisAsOf: "2026-07-26" });

    expect(result.status).toBe("usable");
    if (result.status !== "usable") return;
    expect(result.beta).toBe(1.02);
    expect(result.standardError).toBe(0.067);
    expect(result.observations).toBe(260);
    // The window end, not the pack assembly date: this is the date the estimate
    // is an observation as of.
    expect(result.asOf).toBe("2026-07-19");
    // The method has to carry enough for a reviewer to re-run the regression.
    expect(result.method).toContain("260 weekly returns");
    expect(result.method).toContain("NIFTY 50");
    expect(result.method).toContain("2021-08-01 to 2026-07-19");
    expect(result.method).toContain("se 0.067");
  });

  it("is unusable with a reason when no pack was supplied", () => {
    const result = resolveEquityBeta(null, "TESTCO");

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("No pinned equity beta pack");
  });

  it("is unusable when the run carries no ticker to look up", () => {
    // Not an error: a manually-entered dataset has no exchange ticker, and the
    // honest outcome is a stated prior rather than a guess at which name it is.
    for (const ticker of [null, undefined, "", "   "]) {
      const result = resolveEquityBeta(pack(), ticker);
      expect(result.status).toBe("unusable");
      if (result.status === "unusable") {
        expect(result.ticker).toBeNull();
        expect(result.reason).toContain("No ticker on the run");
      }
    }
  });

  it("names the benchmark when the company is simply not in the pack", () => {
    // Distinct from "measured and too noisy" — a reviewer needs to tell those
    // apart, because only one of them is fixed by refreshing the pack.
    const result = resolveEquityBeta(pack(), "NOTINPACK");

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") {
      expect(result.reason).toContain("no constituent for NOTINPACK");
      expect(result.reason).toContain("NIFTY 50");
    }
  });

  it("matches the ticker case-insensitively and ignores surrounding whitespace", () => {
    expect(resolveEquityBeta(pack(), "testco").status).toBe("usable");
    expect(resolveEquityBeta(pack(), "  TESTCO  ").status).toBe("usable");
  });

  it("rejects an imprecise estimate rather than laundering it into a tier", () => {
    // The defect this gate exists for. IDEA regresses to beta 1.43 with se 0.25
    // and r-squared 0.11 — a number with three decimal places and no
    // measurement behind it.
    const result = resolveEquityBeta(
      pack({ constituents: [observation({ ticker: "IDEA", leveredBeta: 1.4301, standardError: 0.2503, rSquared: 0.1122 })] }),
      "IDEA",
      { analysisAsOf: "2026-07-26" },
    );

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") {
      expect(result.reason).toContain("standard error 0.250");
      expect(result.reason).toContain("r-squared 0.112");
      expect(result.reason).toContain(String(MAX_BETA_STANDARD_ERROR));
    }
  });

  it("accepts an estimate exactly at the standard-error limit", () => {
    // Boundary is inclusive; a name sitting exactly on the threshold is not
    // silently on the wrong side of it.
    const atLimit = resolveEquityBeta(pack({ constituents: [observation({ standardError: MAX_BETA_STANDARD_ERROR })] }), "TESTCO");
    const pastLimit = resolveEquityBeta(pack({ constituents: [observation({ standardError: MAX_BETA_STANDARD_ERROR + 0.001 })] }), "TESTCO");

    expect(atLimit.status).toBe("usable");
    expect(pastLimit.status).toBe("unusable");
  });

  it("requires a minimum number of return observations", () => {
    const result = resolveEquityBeta(pack({ constituents: [observation({ observations: MIN_BETA_OBSERVATIONS - 1 })] }), "TESTCO");

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") {
      expect(result.reason).toContain(`${MIN_BETA_OBSERVATIONS - 1} weekly observation(s)`);
    }
    expect(resolveEquityBeta(pack({ constituents: [observation({ observations: MIN_BETA_OBSERVATIONS })] }), "TESTCO").status).toBe("usable");
  });

  it("rejects a beta outside the plausible band as a likely alignment error", () => {
    // A negative beta on a large-cap Indian equity is almost always a join bug
    // between the return series and the benchmark, not a discovery.
    for (const leveredBeta of [-0.8, 0, 4.2]) {
      const result = resolveEquityBeta(pack({ constituents: [observation({ leveredBeta })] }), "TESTCO");
      expect(result.status).toBe("unusable");
      if (result.status === "unusable") expect(result.reason).toContain("misaligned");
    }
  });

  it("rejects non-finite figures", () => {
    expect(resolveEquityBeta(pack({ constituents: [observation({ leveredBeta: Number.NaN })] }), "TESTCO").status).toBe("unusable");
    expect(resolveEquityBeta(pack({ constituents: [observation({ standardError: Number.POSITIVE_INFINITY })] }), "TESTCO").status).toBe("unusable");
    // r-squared too, even though it gates nothing: it is reported on the usable
    // result and interpolated into the method string, so a NaN would reach a
    // reviewer as "r-squared NaN" on an otherwise confident verdict.
    expect(resolveEquityBeta(pack({ constituents: [observation({ rSquared: Number.NaN })] }), "TESTCO").status).toBe("unusable");
  });

  it("rejects a window ending after the analysis date as look-ahead", () => {
    const result = resolveEquityBeta(pack({ constituents: [observation({ windowEnd: "2026-08-16" })] }), "TESTCO", {
      analysisAsOf: "2026-07-26",
    });

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("look-ahead");
  });

  it("rejects an estimate whose window is past the staleness limit", () => {
    const result = resolveEquityBeta(pack({ constituents: [observation({ windowEnd: "2025-01-05" })] }), "TESTCO", {
      analysisAsOf: "2026-07-26",
    });

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("limit is 180 days");
  });

  it("accepts an estimate exactly at the staleness boundary", () => {
    expect(BETA_STALENESS_DAYS).toBe(180);
    const analysisAsOf = "2026-07-26";
    // 180 days before the analysis, which is the limit rather than past it.
    const atLimit = resolveEquityBeta(pack({ constituents: [observation({ windowEnd: "2026-01-27" })] }), "TESTCO", { analysisAsOf });
    const pastLimit = resolveEquityBeta(pack({ constituents: [observation({ windowEnd: "2026-01-26" })] }), "TESTCO", { analysisAsOf });

    expect(atLimit.status).toBe("usable");
    expect(pastLimit.status).toBe("unusable");
  });

  it("rejects an invalid window end", () => {
    const result = resolveEquityBeta(pack({ constituents: [observation({ windowEnd: "not-a-date" })] }), "TESTCO");

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("invalid window end");
  });

  it("skips the freshness test with no analysis date, but still enforces precision", () => {
    // Same shape as the peer pack: absent an analysis date there is nothing to
    // compare against, so the date checks stand down — but the precision gate
    // must not become a bypass for a caller that omits the date.
    expect(resolveEquityBeta(pack({ constituents: [observation({ windowEnd: "2019-01-04" })] }), "TESTCO").status).toBe("usable");
    expect(resolveEquityBeta(pack({ constituents: [observation({ standardError: 0.25 })] }), "TESTCO").status).toBe("unusable");
  });

  it("honours explicit threshold overrides", () => {
    const noisy = pack({ constituents: [observation({ standardError: 0.25, observations: 60 })] });

    expect(resolveEquityBeta(noisy, "TESTCO", { maxStandardError: 0.3, minObservations: 50 }).status).toBe("usable");
  });
});
