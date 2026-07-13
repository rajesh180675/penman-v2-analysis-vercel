import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ScenarioCalibrationObservation, ScenarioCalibrationPolicy } from "../engine/scenarioCalibration";
import type { GovernedSectorSidecarApproval } from "../engine/sectorCases";
import type { GovernedAdvancedModelInput, ModelPromotionDecision, ModelPromotionDossier, ApprovedRealOptionsCompositionPolicy } from "../engine/advancedModelGovernance";

export interface ResolvedAdvancedModelEvidence {
  readonly request: GovernedAdvancedModelInput;
  readonly dossierHash: string;
  readonly dossier: ModelPromotionDossier;
  readonly promotionDecision: ModelPromotionDecision;
  readonly compositionPolicy: ApprovedRealOptionsCompositionPolicy | null;
}

export interface PlatformGovernanceConnection {
  readonly workspaceId: string;
  readonly scenarioPolicy: Omit<ScenarioCalibrationPolicy, "calibrationAsOf"> | null;
  getAccessToken(): Promise<string>;
  /** Supplies reviewed sidecar inputs; the platform resolves their authority. */
  getAdvancedModelRequests?(issuerId: string, analysisAsOf: string): Promise<readonly GovernedAdvancedModelInput[]>;
}

const PlatformGovernanceContext = createContext<PlatformGovernanceConnection | null>(null);

export function PlatformGovernanceProvider({ connection, children }: { readonly connection: PlatformGovernanceConnection; readonly children: ReactNode }) {
  return <PlatformGovernanceContext.Provider value={connection}>{children}</PlatformGovernanceContext.Provider>;
}

export function usePlatformGovernanceEvidence(issuerId: string | null, analysisAsOf: string) {
  const connection = useContext(PlatformGovernanceContext);
  const [scenarioCalibration, setScenarioCalibration] = useState<{ observations: readonly ScenarioCalibrationObservation[]; policy: ScenarioCalibrationPolicy } | null>(null);
  const [sectorSidecar, setSectorSidecar] = useState<GovernedSectorSidecarApproval | null>(null);
  const [advancedModels, setAdvancedModels] = useState<readonly {
    readonly request: GovernedAdvancedModelInput;
    readonly dossierHash: string;
    readonly dossier: ModelPromotionDossier;
    readonly compositionPolicy: ApprovedRealOptionsCompositionPolicy | null;
  }[] | null>(null);
  const [advancedModelsLoading, setAdvancedModelsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policy = useMemo(() => connection?.scenarioPolicy ? { ...connection.scenarioPolicy, calibrationAsOf: `${analysisAsOf}T23:59:59.999Z` } : null, [analysisAsOf, connection?.scenarioPolicy]);

  useEffect(() => {
    if (!connection || !issuerId) { setScenarioCalibration(null); setSectorSidecar(null); setAdvancedModels(null); setAdvancedModelsLoading(false); setError(null); return; }
    const controller = new AbortController();
    const advancedModelResolutionRequired = Boolean(connection.getAdvancedModelRequests);
    setAdvancedModelsLoading(advancedModelResolutionRequired);
    void (async () => {
      try {
        const token = await connection.getAccessToken();
        const headers = { authorization: `Bearer ${token}`, "x-workspace-id": connection.workspaceId, "content-type": "application/json" };
        const advancedRequests = connection.getAdvancedModelRequests
          ? await connection.getAdvancedModelRequests(issuerId, analysisAsOf)
          : [];
        const [scenarioResponse, sidecarResponse, advancedResponse] = await Promise.all([
          policy ? fetch("/api/platform/governance/scenario-input", { method: "POST", headers, body: JSON.stringify({ policy }), signal: controller.signal }) : Promise.resolve(null),
          fetch(`/api/platform/governance/sector-sidecars?issuerId=${encodeURIComponent(issuerId)}`, { headers, signal: controller.signal }),
          advancedRequests.length
            ? fetch("/api/platform/governance/advanced-models/resolve", { method: "POST", headers, body: JSON.stringify({ requests: advancedRequests }), signal: controller.signal })
            : Promise.resolve(null),
        ]);
        if (scenarioResponse && !scenarioResponse.ok) throw new Error(`Scenario evidence request failed with ${scenarioResponse.status}.`);
        if (!sidecarResponse.ok) throw new Error(`Sector sidecar request failed with ${sidecarResponse.status}.`);
        if (advancedResponse && !advancedResponse.ok) throw new Error(`Advanced-model attestation request failed with ${advancedResponse.status}.`);
        const scenarioPayload = scenarioResponse ? await scenarioResponse.json() as { observations?: ScenarioCalibrationObservation[]; policy?: ScenarioCalibrationPolicy } : null;
        const sidecarPayload = await sidecarResponse.json() as { items?: GovernedSectorSidecarApproval[] };
        const advancedPayload = advancedResponse ? await advancedResponse.json() as { items?: ResolvedAdvancedModelEvidence[] } : null;
        if (controller.signal.aborted) return;
        setScenarioCalibration(scenarioPayload?.policy && Array.isArray(scenarioPayload.observations) ? { observations: scenarioPayload.observations, policy: scenarioPayload.policy } : null);
        const latest = sidecarPayload.items?.[0] ?? null;
        setSectorSidecar(latest?.status === "approved" ? latest : null);
        const resolved = advancedPayload?.items ?? [];
        if (resolved.length !== advancedRequests.length) throw new Error("Advanced-model attestation response did not resolve every requested sidecar.");
        resolved.forEach((item, index) => {
          const requested = advancedRequests[index];
          if (
            !requested
            || item.request.modelId !== requested.modelId
            || item.request.issuerId !== requested.issuerId
            || item.request.sidecarId !== requested.sidecarId
            || item.request.asOf !== requested.asOf
            || item.dossier.modelId !== requested.modelId
            || !/^sha256:[0-9a-f]{64}$/.test(item.dossierHash)
            || (requested.modelId === "advanced.real-options-rd-pipeline" && (!item.compositionPolicy || !/^sha256:[0-9a-f]{64}$/.test(item.compositionPolicy.dossierHash)))
          ) throw new Error("Advanced-model attestation response failed identity or hash validation.");
        });
        setAdvancedModels(resolved.map((item) => ({ request: item.request, dossierHash: item.dossierHash, dossier: item.dossier, compositionPolicy: item.compositionPolicy })));
        setAdvancedModelsLoading(false);
        setError(null);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setScenarioCalibration(null); setSectorSidecar(null); setAdvancedModels(null); setAdvancedModelsLoading(false);
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    })();
    return () => controller.abort();
  }, [analysisAsOf, connection, issuerId, policy]);
  const advancedModelResolutionRequired = Boolean(connection?.getAdvancedModelRequests);
  return {
    scenarioCalibration,
    sectorSidecar,
    advancedModels,
    advancedModelsLoading,
    advancedModelResolutionRequired,
    blocksAnalysis: advancedModelResolutionRequired && (advancedModelsLoading || advancedModels === null || error !== null),
    error,
  } as const;
}
