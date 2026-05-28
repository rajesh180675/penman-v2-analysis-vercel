/* ================================================================
   Plan 1 PR-1.4 — branded-primitive contract tests.

   Twelve cases covering: each constructor's validation, each conversion,
   NaN rejection, range rejection, and brand-preservation under
   arithmetic. The brand-incompatibility check is verified at the
   type level via TS @ts-expect-error markers, not at runtime.
================================================================ */

import { describe, it, expect } from "vitest";
import {
  INRCrore,
  INRAbsolute,
  CroreShares,
  AbsoluteShares,
  PercentFraction,
  BasisPoints,
  croreToAbsolute,
  absoluteToCrore,
  croreSharesToAbsolute,
  absoluteSharesToCrore,
  fractionToBps,
  bpsToFraction,
  addCrore,
  subCrore,
  mulCroreScalar,
  divCrore,
} from "../units";

describe("units — branded primitives (Plan 1 PR-1.4)", () => {
  it("INRCrore: accepts finite numbers (positive, negative, zero)", () => {
    expect(INRCrore(0) as number).toBe(0);
    expect(INRCrore(123.45) as number).toBe(123.45);
    expect(INRCrore(-50) as number).toBe(-50);
  });

  it("INRCrore: rejects NaN and Infinity", () => {
    expect(() => INRCrore(NaN)).toThrow(TypeError);
    expect(() => INRCrore(Infinity)).toThrow(TypeError);
    expect(() => INRCrore(-Infinity)).toThrow(TypeError);
  });

  it("INRAbsolute: accepts finite numbers and rejects NaN", () => {
    expect(INRAbsolute(1e8) as number).toBe(1e8);
    expect(() => INRAbsolute(NaN)).toThrow(TypeError);
  });

  it("CroreShares: rejects negative and non-finite", () => {
    expect(CroreShares(0) as number).toBe(0);
    expect(CroreShares(123.456) as number).toBe(123.456);
    expect(() => CroreShares(-1)).toThrow(TypeError);
    expect(() => CroreShares(NaN)).toThrow(TypeError);
  });

  it("AbsoluteShares: rejects non-integers", () => {
    expect(AbsoluteShares(1_234_500_000) as number).toBe(1_234_500_000);
    expect(() => AbsoluteShares(123.5)).toThrow(TypeError);
    expect(() => AbsoluteShares(-1)).toThrow(TypeError);
    expect(() => AbsoluteShares(NaN)).toThrow(TypeError);
  });

  it("PercentFraction: accepts plausible range [-2, 5]", () => {
    expect(PercentFraction(0.13) as number).toBe(0.13);
    expect(PercentFraction(-2) as number).toBe(-2);
    expect(PercentFraction(5) as number).toBe(5);
  });

  it("PercentFraction: rejects out-of-range (catches percent-vs-fraction bugs)", () => {
    // Value of 13 was almost certainly meant as 0.13 (13%, not 1300%).
    expect(() => PercentFraction(13)).toThrow(RangeError);
    expect(() => PercentFraction(-3)).toThrow(RangeError);
    expect(() => PercentFraction(NaN)).toThrow(TypeError);
  });

  it("BasisPoints: accepts any finite number, rejects NaN", () => {
    expect(BasisPoints(50) as number).toBe(50);
    expect(BasisPoints(-25) as number).toBe(-25);
    expect(() => BasisPoints(NaN)).toThrow(TypeError);
  });

  it("crore <-> absolute round-trip is exact", () => {
    const original = INRCrore(123.45);
    const roundTrip = absoluteToCrore(croreToAbsolute(original));
    expect(roundTrip as number).toBeCloseTo(original as number, 10);
  });

  it("croreShares <-> absoluteShares round-trip is integer-stable", () => {
    const original = CroreShares(123.4567);
    const absolute = croreSharesToAbsolute(original);
    expect(absolute as number).toBe(1_234_567_000);
    // round-trip back is fraction-equivalent
    const back = absoluteSharesToCrore(absolute);
    expect(back as number).toBeCloseTo(original as number, 6);
  });

  it("fraction <-> bps round-trip is exact", () => {
    const f = PercentFraction(0.0125); // 125 bps
    const bps = fractionToBps(f);
    expect(bps as number).toBe(125);
    expect(bpsToFraction(bps) as number).toBeCloseTo(f as number, 10);
  });

  it("crore arithmetic preserves brand and value", () => {
    const a = INRCrore(100);
    const b = INRCrore(50);
    expect(addCrore(a, b) as number).toBe(150);
    expect(subCrore(a, b) as number).toBe(50);
    expect(mulCroreScalar(a, 1.5) as number).toBe(150);
    // Crore / Crore -> PercentFraction (e.g. RNOA = OI / NOA)
    expect(divCrore(a, b) as number).toBe(2);
  });

  it("brand incompatibility caught at compile time (this test is documentation)", () => {
    // The TypeScript compiler refuses code like:
    //
    //   const equity: INRCrore = INRCrore(1000);
    //   const shares: AbsoluteShares = AbsoluteShares(1_000_000);
    //   computeIVPS(equity, shares);
    //   // ^ Error: AbsoluteShares is not assignable to CroreShares
    //
    // We can't assert that here at runtime — the brands are erased
    // before runtime — but this test documents the intent.
    // Negative-test coverage is the @ts-expect-error guards in
    // consumer modules.
    expect(true).toBe(true);
  });
});
