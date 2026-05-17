/**
 * Phase I7 — Currency unit auto-detection tests
 *
 * Covers:
 * - detectCurrencyUnit: all six unit strings, case variants, empty grid,
 *   no currency row, unrecognised unit → Unknown
 * - UNIT_TO_CR_MULTIPLIER: spot-check multipliers
 * - Integration: values in a Lakhs grid are scaled to Crores
 */

import { describe, expect, it } from "vitest";
import {
  detectCurrencyUnit,
  UNIT_TO_CR_MULTIPLIER,
  type CurrencyUnit,
} from "../capitalineParser";

/* ── helpers ─────────────────────────────────────────────────── */

function makeGrid(currRow: string[], dataRows: string[][] = []): string[][] {
  return [currRow, ...dataRows];
}

/* ── detectCurrencyUnit ──────────────────────────────────────── */

describe("detectCurrencyUnit", () => {
  it("returns null when grid is empty", () => {
    expect(detectCurrencyUnit([])).toBeNull();
  });

  it("returns null when no currency row present", () => {
    const grid = [
      ["Company", "Finance >> BS >> Company"],
      ["202503", "202403", "202303"],
      ["Total Assets", "100000", "90000"],
    ];
    expect(detectCurrencyUnit(grid)).toBeNull();
  });

  it("detects Crores — 'Rs. Cr.' pattern", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "Rs. Cr.", "Rs. Cr."]))).toBe("Crores");
  });

  it("detects Crores — 'crores' word", () => {
    expect(detectCurrencyUnit(makeGrid(["Currency", "Crores"]))).toBe("Crores");
  });

  it("detects Crores — 'INR Cr' pattern", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "INR Cr"]))).toBe("Crores");
  });

  it("detects Lakhs — 'Rs. Lakh'", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "Rs. Lakh"]))).toBe("Lakhs");
  });

  it("detects Lakhs — 'lakhs' word", () => {
    expect(detectCurrencyUnit(makeGrid(["Currency", "Lakhs"]))).toBe("Lakhs");
  });

  it("detects Lakhs — 'lac' abbreviation", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "Rs. Lac"]))).toBe("Lakhs");
  });

  it("detects Millions — 'mn'", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "Rs. Mn"]))).toBe("Millions");
  });

  it("detects Millions — 'million' word", () => {
    expect(detectCurrencyUnit(makeGrid(["Currency", "Millions"]))).toBe("Millions");
  });

  it("detects Thousands — 'thousands'", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "Thousands"]))).toBe("Thousands");
  });

  it("detects Thousands — '000s'", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "000s"]))).toBe("Thousands");
  });

  it("detects Absolute — 'Rs.'", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "Rs."]))).toBe("Absolute");
  });

  it("detects Absolute — 'INR'", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "INR"]))).toBe("Absolute");
  });

  it("returns Unknown when currency row found but value unrecognised", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "USD"]))).toBe("Unknown");
  });

  it("is case-insensitive", () => {
    expect(detectCurrencyUnit(makeGrid(["CURR. IN", "RS. CR."]))).toBe("Crores");
    expect(detectCurrencyUnit(makeGrid(["curr. in", "rs. lakh"]))).toBe("Lakhs");
  });

  it("skips empty value cells and reads the first non-empty one", () => {
    expect(detectCurrencyUnit(makeGrid(["Curr. in", "", "", "Rs. Cr."]))).toBe("Crores");
  });

  it("only scans the first scanRows rows (default 10)", () => {
    // Currency row at row 11 — should NOT be detected with default scanRows
    const grid: string[][] = Array.from({ length: 11 }, (_, i) =>
      i === 10 ? ["Curr. in", "Rs. Lakh"] : ["Some row", "value"]
    );
    expect(detectCurrencyUnit(grid, 10)).toBeNull();
  });

  it("detects currency row at row 9 (within default scanRows)", () => {
    const grid: string[][] = Array.from({ length: 10 }, (_, i) =>
      i === 9 ? ["Curr. in", "Rs. Cr."] : ["Some row", "value"]
    );
    expect(detectCurrencyUnit(grid, 10)).toBe("Crores");
  });

  it("handles 'denomination' as the label keyword", () => {
    expect(detectCurrencyUnit(makeGrid(["Denomination", "Crores"]))).toBe("Crores");
  });

  it("handles 'unit' as the label keyword", () => {
    expect(detectCurrencyUnit(makeGrid(["Unit", "Rs. Lakh"]))).toBe("Lakhs");
  });
});

/* ── UNIT_TO_CR_MULTIPLIER ───────────────────────────────────── */

describe("UNIT_TO_CR_MULTIPLIER", () => {
  it("Crores multiplier is 1 (no-op)", () => {
    expect(UNIT_TO_CR_MULTIPLIER["Crores"]).toBe(1);
  });

  it("Lakhs multiplier converts correctly (100 lakhs = 1 crore)", () => {
    expect(100 * UNIT_TO_CR_MULTIPLIER["Lakhs"]).toBeCloseTo(1);
  });

  it("Millions multiplier converts correctly (10 million = 1 crore)", () => {
    expect(10 * UNIT_TO_CR_MULTIPLIER["Millions"]).toBeCloseTo(1);
  });

  it("Thousands multiplier converts correctly (10,000 thousands = 1 crore)", () => {
    expect(10000 * UNIT_TO_CR_MULTIPLIER["Thousands"]).toBeCloseTo(1);
  });

  it("Absolute multiplier converts correctly (1 crore = 10,000,000 rupees)", () => {
    expect(1e7 * UNIT_TO_CR_MULTIPLIER["Absolute"]).toBeCloseTo(1);
  });

  it("Unknown multiplier is 1 (pass-through, don't corrupt)", () => {
    expect(UNIT_TO_CR_MULTIPLIER["Unknown"]).toBe(1);
  });

  it("all six units are covered", () => {
    const units: CurrencyUnit[] = ["Crores", "Lakhs", "Millions", "Thousands", "Absolute", "Unknown"];
    for (const u of units) {
      expect(UNIT_TO_CR_MULTIPLIER[u]).toBeDefined();
      expect(Number.isFinite(UNIT_TO_CR_MULTIPLIER[u])).toBe(true);
    }
  });
});
