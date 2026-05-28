/* ================================================================
   Plan 6 PR-6.2 — Parser fuzz harness.

   Generates deterministic mangled inputs by combining 5 base
   fixtures with 10 mutation classes (50 total). The contract is
   crash-resistance: every mutated input must either parse to a
   valid (possibly-empty) RawPeriodData[] or fail with a structured
   diagnostic — NEVER throw an unhandled exception.

   Why deterministic mutations instead of random fuzzing:
     - Reproducibility: the same fuzz suite runs in CI on every
       commit, so a regression in robustness is caught immediately.
     - Triage: when a mutation breaks the parser, the failing case
       is the same byte-for-byte every time.
     - Bounded cost: 50 cases run in <2s, so it ships in CI rather
       than in a separate pre-release suite.

   Mutation classes (applied to each base):
     1. truncate       cut to first 10% of bytes
     2. duplicate-line dup line N to inflate to 2x
     3. drop-line      remove every other line
     4. shuffle-cells  randomly reorder cells in line N
     5. inject-bom     prepend UTF-8 BOM
     6. inject-nul     scatter NUL bytes through the file
     7. mojibake       map ASCII to confusable UTF-8 lookalikes
     8. extreme-numbers replace numbers with Inf/NaN/1e308
     9. swap-delimiter convert \\t to , (or vice versa)
    10. empty          zero-byte input
================================================================ */

import { describe, it, expect } from "vitest";
import { parseScreenerTabDelimited } from "../screenerParser";

// Five hand-crafted base fixtures covering common screener shapes.
const BASE_FIXTURES: Record<string, string> = {
  "minimal-2-period": [
    "Metric\tFY2023\tFY2024",
    "Revenue\t1000\t1100",
    "Net Profit\t100\t125",
  ].join("\n"),

  "with-blank-rows": [
    "Metric\tFY2023\tFY2024",
    "Revenue\t1000\t1100",
    "",
    "Net Profit\t100\t125",
    "",
    "EBITDA\t180\t210",
  ].join("\n"),

  "with-currency-symbols": [
    "Metric\tFY2023\tFY2024",
    "Revenue (₹ Cr)\t1,000.50\t1,100.75",
    "Net Profit (₹ Cr)\t(100.0)\t125.0",
  ].join("\n"),

  "with-percent-rows": [
    "Metric\tFY2023\tFY2024",
    "Revenue\t1000\t1100",
    "OPM %\t18%\t19.5%",
  ].join("\n"),

  "many-periods": [
    "Metric\tFY2019\tFY2020\tFY2021\tFY2022\tFY2023\tFY2024",
    "Revenue\t800\t850\t900\t1000\t1050\t1100",
    "Net Profit\t60\t65\t75\t100\t110\t125",
  ].join("\n"),
};

/* ============= Mutation operators (deterministic) ============== */

const MUTATIONS: Record<string, (s: string) => string> = {
  truncate(s) {
    return s.slice(0, Math.max(1, Math.floor(s.length / 10)));
  },
  "duplicate-line"(s) {
    const lines = s.split("\n");
    if (lines.length < 2) return s;
    return [...lines, lines[1]!, lines[1]!, lines[1]!].join("\n");
  },
  "drop-line"(s) {
    return s.split("\n").filter((_, i) => i % 2 === 0).join("\n");
  },
  "shuffle-cells"(s) {
    return s
      .split("\n")
      .map((line, i) => {
        if (i === 0 || !line.includes("\t")) return line;
        const cells = line.split("\t");
        // Deterministic reverse-then-rotate for index i
        return cells.reverse().map((_, j, arr) => arr[(j + i) % arr.length]).join("\t");
      })
      .join("\n");
  },
  "inject-bom"(s) {
    return "\uFEFF" + s;
  },
  "inject-nul"(s) {
    return s
      .split("")
      .map((c, i) => (i % 17 === 0 ? "\0" + c : c))
      .join("");
  },
  mojibake(s) {
    const map: Record<string, string> = {
      A: "Α", B: "Β", E: "Ε", I: "Ι", O: "Ο", a: "а", e: "е", o: "о",
    };
    return s.split("").map((c) => map[c] ?? c).join("");
  },
  "extreme-numbers"(s) {
    return s.replace(/\b\d+(\.\d+)?\b/g, (_match, _frac, i) => {
      const arr = ["Infinity", "NaN", "1e308", "-1e308", "0.000000001"];
      return arr[i % arr.length]!;
    });
  },
  "swap-delimiter"(s) {
    return s.replace(/\t/g, ",");
  },
  empty(_s) {
    return "";
  },
};

/* =============== Crash-resistance assertions =================== */

describe("Parser fuzz harness (Plan 6 PR-6.2)", () => {
  const baseNames = Object.keys(BASE_FIXTURES);
  const mutationNames = Object.keys(MUTATIONS);

  it("ships with 5 base fixtures x 10 mutation classes (50 cases)", () => {
    expect(baseNames).toHaveLength(5);
    expect(mutationNames).toHaveLength(10);
  });

  for (const baseName of baseNames) {
    for (const mutName of mutationNames) {
      it(`screenerParser does NOT throw on '${baseName}' x '${mutName}'`, () => {
        const base = BASE_FIXTURES[baseName]!;
        const mutated = MUTATIONS[mutName]!(base);

        // The contract is crash-resistance, not correctness. Any return value
        // is acceptable (including [] for unparseable input). We assert no
        // unhandled exception.
        expect(() => parseScreenerTabDelimited(mutated)).not.toThrow();
      });
    }
  }

  it("parser returns Array on every mutation", () => {
    for (const baseName of baseNames) {
      for (const mutName of mutationNames) {
        const mutated = MUTATIONS[mutName]!(BASE_FIXTURES[baseName]!);
        const result = parseScreenerTabDelimited(mutated);
        expect(Array.isArray(result)).toBe(true);
      }
    }
  });

  it("baseline (un-mutated) fixtures all produce >= 1 period", () => {
    for (const baseName of baseNames) {
      const result = parseScreenerTabDelimited(BASE_FIXTURES[baseName]!);
      expect(result.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("'empty' mutation produces exactly 0 periods", () => {
    for (const baseName of baseNames) {
      const mutated = MUTATIONS.empty!(BASE_FIXTURES[baseName]!);
      const result = parseScreenerTabDelimited(mutated);
      expect(result).toHaveLength(0);
    }
  });
});
