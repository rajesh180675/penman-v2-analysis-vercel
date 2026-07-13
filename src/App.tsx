import { AppShell } from "./app/AppShell";
import { PlatformGovernanceProvider, type PlatformGovernanceConnection } from "./app/platformGovernance";

export interface AppProps {
  readonly platformGovernanceConnection?: PlatformGovernanceConnection;
}

export function App({ platformGovernanceConnection }: AppProps = {}) {
  const shell = <AppShell />;
  return platformGovernanceConnection
    ? <PlatformGovernanceProvider connection={platformGovernanceConnection}>{shell}</PlatformGovernanceProvider>
    : shell;
}
