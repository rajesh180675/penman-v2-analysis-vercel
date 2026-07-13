import type {
  AnalysisRunDraftV1,
  AnalysisRunStatus,
  AnalysisRunV1,
} from "../../engine/analysisRun/contracts";
import type { WorkspaceAccessContext, WorkspaceScope } from "../workspaceScope";

export type AnalysisRunLifecycle = "open" | "finalized";

export interface RunQuery {
  readonly limit?: number | undefined;
  readonly cursor?: string | null | undefined;
  readonly issuerId?: string | null | undefined;
  readonly statuses?: readonly AnalysisRunStatus[] | undefined;
  readonly lifecycle?: AnalysisRunLifecycle | null | undefined;
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface AnalysisRunSummary {
  readonly runId: string;
  readonly issuerId: string;
  readonly status: AnalysisRunStatus;
  readonly lifecycle: AnalysisRunLifecycle;
  readonly asOf: string;
  readonly createdAt: string;
  readonly reproducibilityHash: AnalysisRunV1["reproducibilityHash"];
  readonly revision: number;
}

export interface VersionedAnalysisRun {
  readonly run: AnalysisRunV1;
  readonly lifecycle: AnalysisRunLifecycle;
  readonly revision: number;
}

export interface AnalysisRunRepository {
  create(
    context: WorkspaceAccessContext,
    run: AnalysisRunDraftV1,
    idempotencyKey: string,
  ): Promise<VersionedAnalysisRun>;
  get(scope: WorkspaceScope, runId: string): Promise<VersionedAnalysisRun | null>;
  list(scope: WorkspaceScope, query?: RunQuery | undefined): Promise<CursorPage<AnalysisRunSummary>>;
  finalize(
    context: WorkspaceAccessContext,
    runId: string,
    expectedRevision: number,
  ): Promise<VersionedAnalysisRun>;
}
