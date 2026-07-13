import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernedAdvancedModelInput } from "../engine/advancedModelGovernance";
import { PlatformGovernanceProvider, usePlatformGovernanceEvidence, type PlatformGovernanceConnection } from "./platformGovernance";

const request: GovernedAdvancedModelInput = {
  modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", asOf: "2026-07-13", sidecarId: "options-1", sidecarStatus: "approved",
  evidenceRefs: ["artifact:options"], transformationRefs: ["transform:options"],
  outputBridge: { sourceMonetaryUnit: "INR_CRORE", sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" },
  input: { riskFreeRate: 0.07, projects: [{ id: "drug-1", stage: "phase-3", underlyingValue: 100, developmentCost: 80, timeToDecisionYears: 2, probabilityOfSuccess: 0.5, volatility: 0.4 }] },
};

type HookValue = ReturnType<typeof usePlatformGovernanceEvidence>;

function Probe({ onValue }: { readonly onValue: (value: HookValue) => void }) {
  const value = usePlatformGovernanceEvidence("issuer-1", "2026-07-13");
  onValue(value);
  return null;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("platform governance advanced-model resolution", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("binds resolved dossier hashes and composition policy into run inputs", async () => {
    let latest!: HookValue;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("sector-sidecars")) return response({ items: [] });
      if (url.includes("advanced-models/resolve")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer token-1", "x-workspace-id": "workspace-1" });
        expect(JSON.parse(String(init?.body))).toEqual({ requests: [request] });
        return response({ items: [{
          request, dossierHash: `sha256:${"a".repeat(64)}`,
          dossier: { modelId: request.modelId, reviewerPrincipalIds: ["reviewer-1", "reviewer-2"], evidenceRefs: ["promotion:1"] },
          promotionDecision: { status: "eligible" },
          compositionPolicy: { dossierHash: `sha256:${"b".repeat(64)}` },
        }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const connection: PlatformGovernanceConnection = {
      workspaceId: "workspace-1", scenarioPolicy: null,
      getAccessToken: vi.fn(async () => "token-1"),
      getAdvancedModelRequests: vi.fn(async () => [request]),
    };
    await act(async () => root.render(<PlatformGovernanceProvider connection={connection}><Probe onValue={(value) => { latest = value; }} /></PlatformGovernanceProvider>));
    await vi.waitFor(() => expect(latest.advancedModels).toHaveLength(1));
    expect(latest).toMatchObject({ advancedModelsLoading: false, advancedModelResolutionRequired: true, blocksAnalysis: false, error: null });
    expect(latest.advancedModels?.[0]).toMatchObject({ request, dossierHash: `sha256:${"a".repeat(64)}`, compositionPolicy: { dossierHash: `sha256:${"b".repeat(64)}` } });
  });

  it("keeps analysis fail-closed when platform attestation resolution fails", async () => {
    let latest!: HookValue;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("sector-sidecars")
      ? response({ items: [] })
      : response({ error: "REAL_OPTIONS_COMPOSITION_BLOCKED" }, 409)));
    const connection: PlatformGovernanceConnection = {
      workspaceId: "workspace-1", scenarioPolicy: null, getAccessToken: async () => "token-1", getAdvancedModelRequests: async () => [request],
    };
    await act(async () => root.render(<PlatformGovernanceProvider connection={connection}><Probe onValue={(value) => { latest = value; }} /></PlatformGovernanceProvider>));
    await vi.waitFor(() => expect(latest.error).toContain("409"));
    expect(latest).toMatchObject({ advancedModels: null, advancedModelsLoading: false, advancedModelResolutionRequired: true, blocksAnalysis: true });
  });
});
