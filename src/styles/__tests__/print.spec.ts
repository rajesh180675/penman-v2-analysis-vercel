/* ================================================================
   Plan 7 PR-7.4 — Print stylesheet contract.

   Verifies print.css declares the rules the plan asks for:
   - @page A4 with reasonable margins
   - page counter footer
   - citation variable hooks (var(--print-citation))
   - .print-signature reviewer block
   - .print-hash reproducibility hash slot
================================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const css = readFileSync(resolve(__dirname, "../print.css"), "utf-8");

describe("print stylesheet (Plan 7 PR-7.4)", () => {
  it("declares @media print", () => {
    expect(css).toMatch(/@media\s+print\s*\{/);
  });

  it("declares @page rule with A4 size", () => {
    expect(css).toMatch(/@page\s*\{[\s\S]*size:\s*A4/);
  });

  it("declares page-number footer in @bottom-center", () => {
    expect(css).toMatch(/@bottom-center\s*\{[\s\S]*counter\(page\)/);
  });

  it("declares citation footer hook in @bottom-left via var(--print-citation)", () => {
    expect(css).toMatch(/@bottom-left[\s\S]*var\(--print-citation/);
  });

  it("declares retrieval-date footer hook in @bottom-right", () => {
    expect(css).toMatch(/@bottom-right[\s\S]*var\(--print-retrieval-date/);
  });

  it("declares .print-signature reviewer block with page-break-before", () => {
    expect(css).toMatch(/\.print-signature\s*\{[\s\S]*page-break-before:\s*always/);
  });

  it("declares .print-hash slot for reproducibility hash", () => {
    expect(css).toMatch(/\.print-hash\s*\{/);
  });

  it("hides interactive chrome (header, nav, buttons)", () => {
    expect(css).toMatch(/header,[\s\S]*nav,[\s\S]*\.no-print/);
    expect(css).toMatch(/button,/);
  });

  it("forces print-color-adjust so brand colors render", () => {
    expect(css).toMatch(/print-color-adjust:\s*exact/);
  });

  it("uses serif/system font stack with reasonable point size", () => {
    expect(css).toMatch(/font-size:\s*10pt/);
  });
});
