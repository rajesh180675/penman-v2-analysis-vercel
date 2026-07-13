export type AnalysisRunRepositoryErrorCode =
  | "RUN_ALREADY_EXISTS"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RUN_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "INVALID_CURSOR";

export interface AnalysisRunRepositoryErrorDetails {
  readonly runId?: string | undefined;
  readonly expectedRevision?: number | undefined;
  readonly actualRevision?: number | undefined;
}

/**
 * Stable, adapter-independent failures produced by AnalysisRun metadata
 * repositories. Messages are deliberately payload-safe: storage keys and
 * records from other workspaces are never included.
 */
export class AnalysisRunRepositoryError extends Error {
  readonly code: AnalysisRunRepositoryErrorCode;
  readonly details: Readonly<AnalysisRunRepositoryErrorDetails>;

  constructor(
    code: AnalysisRunRepositoryErrorCode,
    message: string,
    details: AnalysisRunRepositoryErrorDetails = {},
  ) {
    super(message);
    this.name = "AnalysisRunRepositoryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
