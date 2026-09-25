import { lazy, Suspense } from "react";
import { AppShell } from "./app/AppShell";
import { PlatformGovernanceProvider, type PlatformGovernanceConnection } from "./app/platformGovernance";

// The next UI (docs/ui-revamp-plan.md) is opt-in via ?ui=next and loaded as its
// own chunk, so the current interface pays nothing for it.
const NextApp = lazy(() => import("./next/NextApp").then((m) => ({ default: m.NextApp })));

export interface AppProps {
  readonly platformGovernanceConnection?: PlatformGovernanceConnection;
}

export function isNextUiRequested(search: string): boolean {
  return new URLSearchParams(search).get("ui") === "next";
}

export function App({ platformGovernanceConnection }: AppProps = {}) {
  const shell = typeof window !== "undefined" && isNextUiRequested(window.location.search)
    ? <Suspense fallback={null}><NextApp /></Suspense>
    : <AppShell />;
  return platformGovernanceConnection
    ? <PlatformGovernanceProvider connection={platformGovernanceConnection}>{shell}</PlatformGovernanceProvider>
    : shell;
}
