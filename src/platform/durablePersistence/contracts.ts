import type { AnalysisRunRepository } from "../analysisRunRepository";
import type { ArtifactRepository } from "../artifactRepository";
import type { RunOperationsRepository } from "../runOperations";
import type { AtomicRateLimitStore, WorkspaceMembershipStore } from "../security";

export interface SqlQueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly TRow[];
  readonly rowCount: number;
}

export interface SqlTransaction {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<TRow>>;
}

export interface TransactionalSqlDriver extends SqlTransaction {
  transaction<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T>;
  readonly dialect: "postgres-compatible";
}

export interface DurableObjectStore {
  putIfAbsent(key: string, bytes: Uint8Array, options: { readonly contentType: string; readonly contentHash: string }): Promise<"created" | "exists">;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;
}

/** Provider adapters must implement the existing domain repositories; the
 * application service never imports a database or object-store SDK directly.
 */
export interface DurablePlatformAdapters {
  readonly runs: AnalysisRunRepository;
  readonly artifacts: ArtifactRepository;
  readonly operations: RunOperationsRepository;
  readonly memberships: WorkspaceMembershipStore;
  readonly rateLimits: AtomicRateLimitStore;
  readonly sql: TransactionalSqlDriver;
  readonly objects: DurableObjectStore;
}

export interface ProductionAdapterReadiness {
  readonly status: "ready" | "blocked";
  readonly checks: readonly {
    readonly checkId: string;
    readonly passed: boolean;
    readonly summary: string;
  }[];
}

export function evaluateProductionAdapterReadiness(input: Partial<DurablePlatformAdapters>): ProductionAdapterReadiness {
  const required: Array<[keyof DurablePlatformAdapters, string]> = [
    ["runs", "Transactional analysis-run metadata repository"],
    ["artifacts", "Content-addressed artifact repository"],
    ["operations", "Append-only run operations repository"],
    ["memberships", "Workspace membership repository"],
    ["rateLimits", "Atomic distributed rate-limit store"],
    ["sql", "Transactional SQL driver"],
    ["objects", "Durable object store"],
  ];
  const checks = required.map(([key, label]) => ({
    checkId: `adapter:${key}`,
    passed: input[key] != null,
    summary: input[key] != null ? `${label} is configured.` : `${label} is not configured.`,
  }));
  return Object.freeze({ status: checks.every((check) => check.passed) ? "ready" : "blocked", checks: Object.freeze(checks) });
}
