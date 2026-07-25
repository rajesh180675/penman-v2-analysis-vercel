/**
 * Workbench icon set — inline SVG, no dependency.
 * Replaces emoji icons across the app with consistent stroke-based glyphs.
 * All icons render at `size` px, inherit color via currentColor.
 */

export type IconName =
  | "trend-up" | "trend-down" | "trend-flat"
  | "shield-check" | "shield-warning" | "shield-x" | "shield"
  | "doc" | "chart" | "table" | "flask" | "bank" | "users" | "book"
  | "gear" | "search" | "moon" | "sun" | "link" | "chevron-right"
  | "chevron-down" | "alert-triangle" | "info" | "download" | "printer"
  | "filter" | "x" | "folder" | "gauge" | "compass" | "satellite"
  | "layers" | "scale" | "target" | "microscope" | "wrench";

interface IconProps {
  name: IconName;
  size?: number | undefined;
  className?: string | undefined;
  strokeWidth?: number | undefined;
  /** Accessible label — omit for purely decorative icons */
  title?: string | undefined;
}

const PATHS: Record<IconName, string> = {
  "trend-up": "M3 17l6-6 4 4 8-8M21 7v6h-6",
  "trend-down": "M3 7l6 6 4-4 8 8M21 17v-6h-6",
  "trend-flat": "M4 12h16M16 8l4 4-4 4",
  "shield-check": "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3zM9 12l2 2 4-4",
  "shield-warning": "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3zM12 8v4M12 15.5v.5",
  "shield-x": "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3zM9.5 9.5l5 5M14.5 9.5l-5 5",
  "shield": "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z",
  "doc": "M6 2h8l5 5v15a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1zM14 2v5h5M9 12h6M9 16h6M9 8h2",
  "chart": "M4 20V10M10 20V4M16 20v-8M22 20H2",
  "table": "M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14",
  "flask": "M9 3h6M10 3v6l-5 9a2 2 0 001.8 3h10.4A2 2 0 0019 18l-5-9V3M7 15h10",
  "bank": "M3 10l9-7 9 7M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  "users": "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M15 3.13a4 4 0 010 7.75",
  "book": "M4 19.5A2.5 2.5 0 016.5 17H20V2H6.5A2.5 2.5 0 004 4.5v15zM4 19.5A2.5 2.5 0 006.5 22H20v-5",
  "gear": "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  "search": "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  "moon": "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  "sun": "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
  "link": "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  "chevron-right": "M9 18l6-6-6-6",
  "chevron-down": "M6 9l6 6 6-6",
  "alert-triangle": "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01",
  "info": "M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01",
  "download": "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  "printer": "M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z",
  "filter": "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  "x": "M18 6L6 18M6 6l12 12",
  "folder": "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z",
  "gauge": "M12 15l3.5-5.5M20.2 17a9 9 0 10-16.4 0",
  "compass": "M12 22a10 10 0 100-20 10 10 0 000 20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z",
  "satellite": "M13 7l4-4M9 11l4-4M17 5l2 2M5 21l7-7M13 21l4-4a2.83 2.83 0 00-4-4l-4 4a2.83 2.83 0 004 4z",
  "layers": "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  "scale": "M12 3v18M3 7l4 7a4 4 0 01-8 0l4-7zM21 7l-4 7a4 4 0 008 0l-4-7zM5 7h14M8 21h8",
  "target": "M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z",
  "microscope": "M6 18h8M3 22h18M14 22a7 7 0 100-14 7 7 0 000 14zM9 2h2M10 2v6",
  "wrench": "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",
};

export function Icon({ name, size = 16, className, strokeWidth = 2, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
