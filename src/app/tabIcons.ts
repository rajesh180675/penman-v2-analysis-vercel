import type { IconName } from "../components/shared/Icon";
import type { TabId } from "./tabs";

/**
 * Single source of truth for tab → SVG icon. Previously copy-pasted into both
 * AppHeader and SidebarNav; now that the header tab strip is gone, SidebarNav
 * is the only consumer, but the map stays here so any future nav surface shares it.
 */
export const TAB_ICONS: Record<TabId, IconName> = {
  upload: "database",
  dashboard: "chart",
  watchlist: "folder",
  workspace: "compass",
  inspector: "satellite",
  statements: "table",
  ratios: "calculator",
  quality: "search",
  scope: "mirror",
  atlas: "satellite",
  business: "building",
  forecast: "trending-up",
  valuation: "currency",
  bank: "bank",
  comparison: "users",
  report: "book",
  thesis: "document",
  regression: "flask",
  v3analytics: "microscope",
  debug: "wrench",
  design: "layers",
  charts: "chart",
};
