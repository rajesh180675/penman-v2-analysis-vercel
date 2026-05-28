/* ================================================================
   Plan 7 PR-7.3 — Responsive breakpoint utilities.

   Tailwind already provides classes for responsive styling, but
   some logic must run in JS — like switching from a wide table
   layout to a card-stacked layout below md, or swapping a 12-col
   grid for a single-column on xs.

   This hook returns the active breakpoint and updates on resize,
   keyed to Tailwind's default breakpoints so JS and CSS agree.

   API:
     useBreakpoint()                         -> "xs" | "sm" | "md" | "lg" | "xl"
     getBreakpoint(width)                    -> classify a width
     isBreakpointAtLeast("md", width)        -> min-width query

   Used by:
     - Future card-stacked table component (PR-7.3 follow-up)
     - Mobile-first refactors of valuation/forecast tabs (Plan 7 PR-7.3 follow-up)

   PR-7.3 ships the hook + utilities; component adoption is a
   follow-up so the primitive is testable and dropped into existing
   components incrementally.
================================================================ */

import { useEffect, useState } from "react";

export type Breakpoint = "xs" | "sm" | "md" | "lg" | "xl";

/** Tailwind default breakpoints (px). */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export function getBreakpoint(width: number): Breakpoint {
  if (width >= BREAKPOINTS.xl) return "xl";
  if (width >= BREAKPOINTS.lg) return "lg";
  if (width >= BREAKPOINTS.md) return "md";
  if (width >= BREAKPOINTS.sm) return "sm";
  return "xs";
}

const ORDER: Record<Breakpoint, number> = {
  xs: 0,
  sm: 1,
  md: 2,
  lg: 3,
  xl: 4,
};

export function isBreakpointAtLeast(target: Breakpoint, width: number): boolean {
  return ORDER[getBreakpoint(width)] >= ORDER[target];
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window === "undefined" ? "lg" : getBreakpoint(window.innerWidth),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onResize = () => setBp(getBreakpoint(window.innerWidth));
    window.addEventListener("resize", onResize);
    // Run once in case the SSR default ('lg') diverged from actual viewport
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return bp;
}
