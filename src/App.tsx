import { lazy, Suspense } from "react";
import { AppShell } from "./app/AppShell";
import { PlatformGovernanceProvider, type PlatformGovernanceConnection } from "./app/platformGovernance";

// The next UI (docs/ui-revamp-plan.md) is its own chunk, so the classic
// interface pays nothing for it.
const NextApp = lazy(() => import("./next/NextApp").then((m) => ({ default: m.NextApp })));

export interface AppProps {
  readonly platformGovernanceConnection?: PlatformGovernanceConnection;
}

/**
 * Which interface a URL asks for. The next UI is the default (Phase 6
 * cutover). `?ui=classic` opens the classic interface, and so does a classic
 * deep link — `?company=` or `?tab=` without a `ui` flag — so links written
 * for the classic shell keep landing where they were meant to.
 */
export function selectInterface(search: string): "next" | "classic" {
  const params = new URLSearchParams(search);
  const ui = params.get("ui");
  if (ui === "classic") return "classic";
  if (ui === "next") return "next";
  return params.has("company") || params.has("tab") ? "classic" : "next";
}

export function App({ platformGovernanceConnection }: AppProps = {}) {
  const shell = typeof window !== "undefined" && selectInterface(window.location.search) === "classic"
    ? <AppShell />
    : <Suspense fallback={null}><NextApp /></Suspense>;
  return platformGovernanceConnection
    ? <PlatformGovernanceProvider connection={platformGovernanceConnection}>{shell}</PlatformGovernanceProvider>
    : shell;
}
