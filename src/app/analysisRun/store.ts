import {
  verifyAnalysisRunIdentity,
  type AnalysisRunForkReason,
  type AnalysisRunRelation,
  type AnalysisRunV1,
  type LegacyAnalysisRunExecutionResult,
  type LegacyAnalysisRunMaterializationV1,
  type Sha256ContentId,
  type AnalysisContentArtifact,
} from "../../engine/analysisRun";
import { canonicalize } from "../../lib/evidenceLocking";
import {
  AnalysisPlatformServiceV1,
  createInMemoryAnalysisRunRepository,
  createInMemoryArtifactRepository,
  createInMemoryRunOperationsRepository,
  createLocalWorkspaceAccessContext,
  type RunAuditEvent,
  type WorkspaceAccessContext,
  LocalOnlyPlatformSecurityBoundary,
} from "../../platform";
import { buildPortfolioRunComparison, type PortfolioComparisonPolicy } from "../../engine/portfolioRunComparison";

export interface StoredAnalysisRun {
  readonly run: AnalysisRunV1;
  readonly materialization: LegacyAnalysisRunMaterializationV1;
  readonly artifacts: readonly AnalysisContentArtifact[];
}

export interface AnalysisRunStoreSnapshot {
  readonly currentRunId: string | null;
  readonly runIds: readonly string[];
  readonly revision: number;
}

export type AnalysisRunStoreListener = (snapshot: AnalysisRunStoreSnapshot) => void;

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) clone[key] = cloneAndFreeze(nested);
    return Object.freeze(clone) as unknown as T;
  }
  return value;
}

export class AnalysisRunStore {
  private readonly runs = new Map<string, StoredAnalysisRun>();
  private readonly runIdsByHash = new Map<Sha256ContentId, Set<string>>();
  private readonly listeners = new Set<AnalysisRunStoreListener>();
  private currentRunId: string | null = null;
  private revision = 0;
  private readonly platform: AnalysisPlatformServiceV1;
  private readonly platformContext: WorkspaceAccessContext;

  constructor(options?: {
    readonly platform?: AnalysisPlatformServiceV1 | undefined;
    readonly context?: WorkspaceAccessContext | undefined;
  }) {
    this.platform = options?.platform ?? new AnalysisPlatformServiceV1(
      createInMemoryAnalysisRunRepository(),
      createInMemoryArtifactRepository(),
      createInMemoryRunOperationsRepository(),
      new LocalOnlyPlatformSecurityBoundary(),
    );
    this.platformContext = options?.context ?? createLocalWorkspaceAccessContext("browser-user", "analysis-workspace");
  }

  private retentionUntil(run: AnalysisRunV1): string | null {
    const days = run.trustEnvelope.governance?.retentionDays;
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return null;
    return new Date(Date.parse(run.createdAt) + days * 86_400_000).toISOString();
  }

  private async persistExecution(result: LegacyAnalysisRunExecutionResult): Promise<void> {
    if (!result.run) throw new Error("A finalized run is required for platform persistence.");
    for (const artifact of result.artifacts) {
      const bytes = new TextEncoder().encode(canonicalize(artifact.payload as Record<string, unknown>));
      const persistedRef = await this.platform.putArtifact(this.platformContext, bytes, {
        kind: artifact.ref.kind,
        schemaVersion: artifact.ref.schemaVersion,
        mediaType: artifact.ref.mediaType,
        contentClass: "analysis-run-artifact",
        createdAt: result.run.createdAt,
        issuerId: result.run.issuerId,
        retentionUntil: this.retentionUntil(result.run),
      });
      if (
        persistedRef.contentHash !== artifact.ref.contentHash
        || persistedRef.byteLength !== artifact.ref.byteLength
      ) {
        throw new Error(`Artifact ${artifact.ref.contentHash} failed content-addressed persistence verification.`);
      }
    }
    const { reproducibilityHash: _identity, ...draft } = result.run;
    const stamp = {
      eventId: `${result.run.runId}:created`,
      occurredAt: result.run.createdAt,
      correlationId: result.run.runId,
      idempotencyKey: `${result.run.runId}:create`,
    };
    const created = await this.platform.createRun(this.platformContext, draft, stamp);
    if (created.run.reproducibilityHash !== result.run.reproducibilityHash) {
      throw new Error(`AnalysisRun ${result.run.runId} changed identity during metadata persistence.`);
    }
    await this.platform.finalizeRun(this.platformContext, result.run.runId, created.revision, {
      eventId: `${result.run.runId}:finalized`,
      occurredAt: result.run.createdAt,
      correlationId: result.run.runId,
      idempotencyKey: `${result.run.runId}:finalize`,
    });
  }

  snapshot(): AnalysisRunStoreSnapshot {
    return Object.freeze({
      currentRunId: this.currentRunId,
      runIds: Object.freeze([...this.runs.keys()]),
      revision: this.revision,
    });
  }

  subscribe(listener: AnalysisRunStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  async addExecution(
    result: LegacyAnalysisRunExecutionResult,
    options?: { readonly makeCurrent?: boolean | undefined },
  ): Promise<StoredAnalysisRun> {
    if (!result.run) throw new Error("Cannot store a failed execution without a finalized AnalysisRun.");
    if (!await verifyAnalysisRunIdentity(result.run)) {
      throw new Error(`AnalysisRun ${result.run.runId} failed reproducibility-hash verification.`);
    }
    const existing = this.runs.get(result.run.runId);
    if (existing) {
      if (existing.run.reproducibilityHash !== result.run.reproducibilityHash) {
        throw new Error(`Run id ${result.run.runId} is immutable and already refers to different content.`);
      }
      if (options?.makeCurrent) this.setCurrent(result.run.runId);
      return existing;
    }

    await this.persistExecution(result);

    const stored = cloneAndFreeze({
      run: result.run,
      materialization: result.materialization,
      artifacts: result.artifacts,
    });
    this.runs.set(stored.run.runId, stored);
    const byHash = this.runIdsByHash.get(stored.run.reproducibilityHash) ?? new Set<string>();
    byHash.add(stored.run.runId);
    this.runIdsByHash.set(stored.run.reproducibilityHash, byHash);
    if (options?.makeCurrent ?? this.currentRunId == null) this.currentRunId = stored.run.runId;
    this.publish();
    return stored;
  }

  setCurrent(runId: string): void {
    if (!this.runs.has(runId)) throw new Error(`Unknown AnalysisRun ${runId}.`);
    if (this.currentRunId === runId) return;
    this.currentRunId = runId;
    this.publish();
  }

  get(runId: string): StoredAnalysisRun | null {
    return this.runs.get(runId) ?? null;
  }

  getCurrent(): StoredAnalysisRun | null {
    return this.currentRunId ? this.get(this.currentRunId) : null;
  }

  findByHash(hash: Sha256ContentId): readonly StoredAnalysisRun[] {
    return Object.freeze([...(this.runIdsByHash.get(hash) ?? [])]
      .map((runId) => this.runs.get(runId))
      .filter((run): run is StoredAnalysisRun => run != null));
  }

  selectRecastData(
    runId = this.currentRunId,
  ): NonNullable<LegacyAnalysisRunMaterializationV1["pipelineResult"]>["periods"] {
    const periods = runId ? this.runs.get(runId)?.materialization.pipelineResult?.periods ?? [] : [];
    return periods;
  }

  selectMaterialization(runId = this.currentRunId): LegacyAnalysisRunMaterializationV1 | null {
    return runId ? this.runs.get(runId)?.materialization ?? null : null;
  }

  selectCommandCenter(runId = this.currentRunId): LegacyAnalysisRunMaterializationV1["commandCenter"] {
    return runId ? this.runs.get(runId)?.materialization.commandCenter ?? null : null;
  }

  selectTrustEnvelope(runId = this.currentRunId): AnalysisRunV1["trustEnvelope"] | null {
    return runId ? this.runs.get(runId)?.run.trustEnvelope ?? null : null;
  }

  selectModelResults(runId = this.currentRunId): LegacyAnalysisRunMaterializationV1["modelResults"] {
    return runId ? this.runs.get(runId)?.materialization.modelResults ?? [] : [];
  }

  selectArtifact(contentHash: Sha256ContentId, runId = this.currentRunId): AnalysisContentArtifact | null {
    if (!runId) return null;
    return this.runs.get(runId)?.artifacts.find((artifact) => artifact.ref.contentHash === contentHash) ?? null;
  }

  selectPortfolioComparison(policy: PortfolioComparisonPolicy) {
    const latestByIssuer = new Map<string, StoredAnalysisRun>();
    for (const stored of this.runs.values()) {
      const existing = latestByIssuer.get(stored.run.issuerId);
      if (!existing || Date.parse(stored.run.createdAt) > Date.parse(existing.run.createdAt)) latestByIssuer.set(stored.run.issuerId, stored);
    }
    return buildPortfolioRunComparison([...latestByIssuer.values()].map((stored) => {
      const commandCenter = stored.materialization.commandCenter;
      const synthesis = commandCenter?.evidenceWeightedSynthesis;
      const range = synthesis?.intrinsicRange;
      return {
        issuerId: stored.run.issuerId, label: stored.run.issuerId, family: stored.run.family ?? "unknown",
        runId: stored.run.runId, reproducibilityHash: stored.run.reproducibilityHash,
        runSchemaVersion: stored.run.schemaVersion, policyBundleHash: stored.run.policyBundleRef.contentHash,
        asOf: stored.run.asOf, status: stored.run.status, confidence: stored.run.trustEnvelope.confidence.status,
        rangeEligible: synthesis?.defensibility.status !== "blocked"
          && [range?.lowPerShare, range?.midPerShare, range?.highPerShare].every((value) => value != null && Number.isFinite(value)),
        lowPerShare: range?.lowPerShare ?? null, midPerShare: range?.midPerShare ?? null, highPerShare: range?.highPerShare ?? null,
        opportunityScore: commandCenter?.opportunity.opportunityScore ?? null,
        qualityScore: commandCenter?.opportunity.qualityScore ?? null,
        expectedCagrStress: commandCenter?.opportunity.expectedCagrStress ?? null,
      };
    }), policy);
  }

  async getPersistedRun(runId: string) {
    return this.platform.getRun(this.platformContext, runId);
  }

  async listAuditEvents(runId: string): Promise<readonly RunAuditEvent[]> {
    return this.platform.listRunEvents(this.platformContext, runId);
  }
}

export function createChildRunRelation(
  parent: AnalysisRunV1,
  forkReason: AnalysisRunForkReason,
): AnalysisRunRelation {
  return Object.freeze({
    kind: "child",
    parentRunId: parent.runId,
    parentReproducibilityHash: parent.reproducibilityHash,
    forkReason,
  });
}
