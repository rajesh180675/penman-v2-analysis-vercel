/**
 * ViewLayout — standard canvas wrapper for every analysis tab (Phase 4).
 * Provides consistent max-width, spacing, and Zone-A context header.
 * Each tab component wraps its content in this rather than hand-rolling
 * `space-y-6` / `space-y-8` / `space-y-4`.
 *
 * See docs/greenfield-ui-redesign.md §2.3 "3-zone canvas".
 */
import { type ReactNode } from "react";

interface ViewLayoutProps {
  children: ReactNode;
  /**
   * Spacing between sections. Defaults to `space-y-6` (the doc's
   * standard spacing token). Tabs that need more room can pass `space-y-8`.
   */
  spacing?: "space-y-4" | "space-y-6" | "space-y-8" | undefined;
  className?: string | undefined;
}

export function ViewLayout({ children, spacing = "space-y-6", className = "" }: ViewLayoutProps) {
  return (
    <div className={`${spacing} ${className}`}>
      {children}
    </div>
  );
}