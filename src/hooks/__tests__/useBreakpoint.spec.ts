/* ================================================================
   Plan 7 PR-7.3 — Breakpoint utility contract tests.

   Tests the pure functions only (getBreakpoint, isBreakpointAtLeast).
   The useBreakpoint hook is verified by manual QA — adding
   @testing-library/react just for this test would add a 1MB
   dev-dep for one hook.
================================================================ */

import { describe, it, expect } from "vitest";
import { getBreakpoint, isBreakpointAtLeast, BREAKPOINTS } from "../useBreakpoint";

describe("breakpoints (Plan 7 PR-7.3)", () => {
  it("BREAKPOINTS exposes Tailwind-aligned thresholds", () => {
    expect(BREAKPOINTS.sm).toBe(640);
    expect(BREAKPOINTS.md).toBe(768);
    expect(BREAKPOINTS.lg).toBe(1024);
    expect(BREAKPOINTS.xl).toBe(1280);
  });

  it("getBreakpoint returns 'xs' below 640px", () => {
    expect(getBreakpoint(320)).toBe("xs");
    expect(getBreakpoint(639)).toBe("xs");
  });

  it("getBreakpoint returns 'sm' between 640 and 767", () => {
    expect(getBreakpoint(640)).toBe("sm");
    expect(getBreakpoint(767)).toBe("sm");
  });

  it("getBreakpoint returns 'md' at 768", () => {
    expect(getBreakpoint(768)).toBe("md");
    expect(getBreakpoint(1023)).toBe("md");
  });

  it("getBreakpoint returns 'lg' at 1024", () => {
    expect(getBreakpoint(1024)).toBe("lg");
    expect(getBreakpoint(1279)).toBe("lg");
  });

  it("getBreakpoint returns 'xl' at 1280+", () => {
    expect(getBreakpoint(1280)).toBe("xl");
    expect(getBreakpoint(1920)).toBe("xl");
  });

  it("isBreakpointAtLeast resolves min-width queries", () => {
    expect(isBreakpointAtLeast("md", 1024)).toBe(true);
    expect(isBreakpointAtLeast("md", 768)).toBe(true);
    expect(isBreakpointAtLeast("md", 767)).toBe(false);
    expect(isBreakpointAtLeast("lg", 768)).toBe(false);
    expect(isBreakpointAtLeast("sm", 320)).toBe(false);
    expect(isBreakpointAtLeast("xs", 0)).toBe(true);
  });

  it("getBreakpoint at exact thresholds picks the larger bucket (>=)", () => {
    // The boundary belongs to the larger bucket per Tailwind convention
    expect(getBreakpoint(BREAKPOINTS.sm)).toBe("sm");
    expect(getBreakpoint(BREAKPOINTS.md)).toBe("md");
    expect(getBreakpoint(BREAKPOINTS.lg)).toBe("lg");
    expect(getBreakpoint(BREAKPOINTS.xl)).toBe("xl");
  });
});
