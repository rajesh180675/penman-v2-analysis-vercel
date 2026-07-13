import {
  prepareAnalysisSnapshotTransport,
  type AnalysisSnapshot,
  type PreparedAnalysisSnapshotTransport,
} from "./auditSnapshotTransport";

export const AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION = "audit-snapshot-worker-v1" as const;

export type AuditSnapshotWorkerRequest = {
  protocolVersion: typeof AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION;
  type: "audit-snapshot/prepare";
  requestId: string;
  snapshot: AnalysisSnapshot;
};

export type AuditSnapshotWorkerResponse =
  | {
      protocolVersion: typeof AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION;
      type: "audit-snapshot/prepared";
      requestId: string;
      result: PreparedAnalysisSnapshotTransport;
    }
  | {
      protocolVersion: typeof AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION;
      type: "audit-snapshot/error";
      requestId: string | null;
      message: string;
    };

export interface AuditSnapshotWorkerScope {
  postMessage(message: AuditSnapshotWorkerResponse): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export function isAuditSnapshotWorkerRequest(value: unknown): value is AuditSnapshotWorkerRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<AuditSnapshotWorkerRequest>;
  return request.protocolVersion === AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION
    && request.type === "audit-snapshot/prepare"
    && typeof request.requestId === "string"
    && Boolean(request.snapshot && typeof request.snapshot === "object");
}

export function attachAuditSnapshotWorker(scope: AuditSnapshotWorkerScope): () => void {
  const listener = (event: { data: unknown }) => {
    if (!isAuditSnapshotWorkerRequest(event.data)) {
      scope.postMessage({
        protocolVersion: AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION,
        type: "audit-snapshot/error",
        requestId: null,
        message: "Worker message does not match the audit snapshot protocol.",
      });
      return;
    }
    const request = event.data;
    void prepareAnalysisSnapshotTransport(request.snapshot)
      .then((result) => scope.postMessage({
        protocolVersion: AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION,
        type: "audit-snapshot/prepared",
        requestId: request.requestId,
        result,
      }))
      .catch((error: unknown) => scope.postMessage({
        protocolVersion: AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION,
        type: "audit-snapshot/error",
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      }));
  };
  scope.addEventListener("message", listener);
  return () => scope.removeEventListener("message", listener);
}
