import { useEffect, useMemo, useRef, useState } from "react";
import type { BankQualityIndicators } from "../../engine/bankQualityIndicators";
import type { CapitalineParseDebug } from "../../engine/capitalineParser";
import {
  startBrowserAnalysisRun,
  type BrowserAnalysisRunTask,
} from "../../engine/analysisRun/browserClient";
import type {
  AnalysisRunExecutionState,
  AnalysisRunProgressMessageV1,
  AnalysisRunRelation,
  AnalysisRunV1,
  LegacyAnalysisRunInputV1,
} from "../../engine/analysisRun";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";
import type { CanonicalFactIngestionBundle } from "../../engine/facts";
import type { SourceParserDiagnostics } from "../../engine/parserDiagnostics";
import type { SegmentData } from "../../engine/segmentParser";
import type { EngineConfig, RawPeriodData } from "../../engine/types";
import type { AuditSubmissionMeta } from "../../lib/audit";
import type { ScenarioCalibrationObservation, ScenarioCalibrationPolicy } from "../../engine/scenarioCalibration";
import type { GovernedSectorSidecarApproval } from "../../engine/sectorCases";
import { AnalysisRunStore, type StoredAnalysisRun } from "./store";

export interface AnalysisRunExecutionInputs {
  readonly rawData: readonly RawPeriodData[] | null;
  readonly config: EngineConfig;
  readonly bankQuality: BankQualityIndicators | null;
  readonly debugInfo: CapitalineParseDebug | null;
  readonly parserDiagnostics: SourceParserDiagnostics | null;
  readonly auditMeta: AuditSubmissionMeta | null;
  readonly marketSnapshot: LiveMarketDataSnapshot | null;
  readonly segmentData: SegmentData | null;
  readonly canonicalFacts: CanonicalFactIngestionBundle | null;
  readonly scenarioCalibration?: {
    readonly observations: readonly ScenarioCalibrationObservation[];
    readonly policy: ScenarioCalibrationPolicy;
  } | null;
  readonly sectorSidecar?: GovernedSectorSidecarApproval | null;
  readonly advancedModels?: LegacyAnalysisRunInputV1["advancedModels"];
}

export interface AnalysisRunExecutionView {
  readonly store: AnalysisRunStore;
  readonly stored: StoredAnalysisRun | null;
  readonly run: AnalysisRunV1 | null;
  readonly state: AnalysisRunExecutionState | "idle";
  readonly progress: AnalysisRunProgressMessageV1 | null;
  readonly error: string | null;
}

interface PreviousExecution {
  readonly issuerId: string;
  readonly rawFingerprint: string;
  readonly configFingerprint: string;
  readonly marketFingerprint: string;
  readonly run: AnalysisRunV1;
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function relationForExecution(
  previous: PreviousExecution | null,
  issuerId: string,
  fingerprints: Omit<PreviousExecution, "issuerId" | "run">,
): AnalysisRunRelation {
  if (!previous || previous.issuerId !== issuerId) {
    return { kind: "root", parentRunId: null, parentReproducibilityHash: null };
  }
  const forkReason = previous.rawFingerprint !== fingerprints.rawFingerprint
    ? "source-restatement"
    : previous.marketFingerprint !== fingerprints.marketFingerprint
      ? "market-refresh"
      : previous.configFingerprint !== fingerprints.configFingerprint
        ? "assumption-change"
        : "manual-rerun";
  return {
    kind: "child",
    parentRunId: previous.run.runId,
    parentReproducibilityHash: previous.run.reproducibilityHash,
    forkReason,
  };
}

/**
 * Browser execution coordinator for the strangler migration.
 *
 * Each input change cancels the older request, creates a new immutable run,
 * verifies it in the store, and exposes only the selected run. No analytical
 * engine is called from React's render path.
 */
export function useAnalysisRunExecution(
  inputs: AnalysisRunExecutionInputs,
): AnalysisRunExecutionView {
  const [store] = useState(() => new AnalysisRunStore());
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [state, setState] = useState<AnalysisRunExecutionState | "idle">("idle");
  const [progress, setProgress] = useState<AnalysisRunProgressMessageV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const previousRef = useRef<PreviousExecution | null>(null);
  // Keep the last successfully-stored run so downstream consumers (tabs,
  // valuation surfaces) don't blank out while a superseding run is in flight.
  // Cleared only when rawData itself goes away (company switch / reset).
  const lastStoredRef = useRef<StoredAnalysisRun | null>(null);

  const rawFingerprint = useMemo(() => fingerprint(inputs.rawData), [inputs.rawData]);
  const configFingerprint = useMemo(() => fingerprint(inputs.config), [inputs.config]);
  const marketFingerprint = useMemo(() => fingerprint(inputs.marketSnapshot), [inputs.marketSnapshot]);
  const auditFingerprint = useMemo(() => fingerprint(inputs.auditMeta), [inputs.auditMeta]);
  const auxiliaryFingerprint = useMemo(() => fingerprint({
    bankQuality: inputs.bankQuality,
    debugInfo: inputs.debugInfo,
    parserDiagnostics: inputs.parserDiagnostics,
    segmentData: inputs.segmentData,
    canonicalFacts: inputs.canonicalFacts,
    scenarioCalibration: inputs.scenarioCalibration ?? null,
    sectorSidecar: inputs.sectorSidecar ?? null,
    advancedModels: inputs.advancedModels ?? null,
  }), [inputs.advancedModels, inputs.bankQuality, inputs.canonicalFacts, inputs.debugInfo, inputs.parserDiagnostics, inputs.scenarioCalibration, inputs.sectorSidecar, inputs.segmentData]);

  useEffect(() => {
    if (!inputs.rawData?.length) {
      setActiveRunId(null);
      setState("idle");
      setProgress(null);
      setError(null);
      lastStoredRef.current = null;
      return;
    }

    // Company switch: rawData changed to a different issuer. Clear the
    // last-stored fallback so tabs don't show the previous company's data
    // while the new company's first run is in flight.
    const currentIssuer = inputs.auditMeta?.companyId ?? inputs.rawData[0]?.company_id ?? null;
    if (lastStoredRef.current && lastStoredRef.current.run.issuerId !== currentIssuer) {
      lastStoredRef.current = null;
      setActiveRunId(null);
    }

    let disposed = false;
    let task: BrowserAnalysisRunTask | null = null;
    // Do NOT clear activeRunId here — keep the previous run visible while the
    // superseding run is in flight. Tabs stay populated during config/market
    // re-runs. Only clear when rawData itself is removed (handled above) or
    // the issuer changes (handled above).
    setState("queued");
    setProgress(null);
    setError(null);

    // Collapse the short config initialization burst into one worker run.
    const timer = window.setTimeout(() => {
      if (disposed) return;
      sequenceRef.current += 1;
      const ordinal = sequenceRef.current.toString().padStart(4, "0");
      const auditRunId = inputs.auditMeta?.runId ?? `local-${inputs.rawData![0]?.company_id ?? "issuer"}`;
      const requestId = `${auditRunId}:analysis:${ordinal}`;
      const issuerId = inputs.auditMeta?.companyId ?? inputs.rawData![0]?.company_id ?? "unknown-issuer";
      const now = new Date().toISOString();
      const fingerprints = { rawFingerprint, configFingerprint, marketFingerprint };
      const relation = relationForExecution(previousRef.current, issuerId, fingerprints);
      const input: LegacyAnalysisRunInputV1 = {
        rawData: inputs.rawData!,
        config: inputs.config,
        marketSnapshot: inputs.marketSnapshot,
        segmentData: inputs.segmentData,
        bankQuality: inputs.bankQuality,
        debugInfo: inputs.debugInfo,
        parserDiagnostics: inputs.parserDiagnostics,
        canonicalFacts: inputs.canonicalFacts,
        metadata: {
          runId: requestId,
          issuerId,
          asOf: now.slice(0, 10),
          createdAt: now,
          generatedAt: now,
          sourceMode: inputs.auditMeta?.sourceMode ?? "manual",
          relation,
          contentClass: inputs.auditMeta?.contentClass ?? null,
          retentionDays: inputs.auditMeta?.retentionDays ?? null,
          runInspectorEnabled: Boolean(inputs.auditMeta?.runAccessToken),
        },
        scenarioCalibration: inputs.scenarioCalibration ?? null,
        sectorSidecar: inputs.sectorSidecar ?? null,
        advancedModels: inputs.advancedModels ?? null,
      };

      task = startBrowserAnalysisRun({
        requestId,
        input,
        onProgress: (nextProgress) => {
          if (disposed) return;
          setProgress(nextProgress);
          setState(nextProgress.state);
        },
      });
      void task.result.then(async (result) => {
        if (disposed) return;
        if (result.status === "failed" && !result.run) {
          setState("failed");
          setError(`${result.errorCode}: ${result.message}`);
          return;
        }
        const stored = await store.addExecution(result, { makeCurrent: true });
        if (disposed) return;
        previousRef.current = { issuerId, ...fingerprints, run: stored.run };
        lastStoredRef.current = stored;
        setActiveRunId(stored.run.runId);
        setState(result.status);
      }).catch((executionError: unknown) => {
        if (disposed) return;
        setState("failed");
        setError(executionError instanceof Error ? executionError.message : String(executionError));
      });
    }, 75);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      task?.cancel("Superseded by newer analytical inputs.");
    };
  }, [
    auditFingerprint,
    auxiliaryFingerprint,
    configFingerprint,
    marketFingerprint,
    rawFingerprint,
    store,
  ]);

  // Repository reads return defensive clones. Memoize the selected projection
  // so render-only state changes cannot manufacture a new analytical object
  // graph and retrigger persistence effects in downstream tabs.
  //
  // Fallback: when activeRunId is null (re-run in flight), expose the last
  // successfully-stored run so tabs don't blank out. This is safe because
  // the store's runs are immutable — the old run remains valid until the new
  // one replaces it.
  const stored = useMemo(
    () => activeRunId ? store.get(activeRunId) : lastStoredRef.current,
    [activeRunId, store],
  );
  return {
    store,
    stored,
    run: stored?.run ?? null,
    state,
    progress,
    error,
  };
}

export const analysisRunCoordinatorInternals = {
  relationForExecution,
};
