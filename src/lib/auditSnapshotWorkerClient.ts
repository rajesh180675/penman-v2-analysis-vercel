import {
  prepareAnalysisSnapshotTransport,
  type AnalysisSnapshot,
  type PreparedAnalysisSnapshotTransport,
} from "./auditSnapshotTransport";
import {
  AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION,
  type AuditSnapshotWorkerRequest,
  type AuditSnapshotWorkerResponse,
} from "./auditSnapshotWorkerProtocol";

type PendingRequest = {
  resolve(value: PreparedAnalysisSnapshotTransport): void;
  reject(error: Error): void;
};

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<string, PendingRequest>();

function resetWorker(error: Error): void {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./auditSnapshot.worker.ts", import.meta.url), {
      type: "module",
      name: "penman-audit-snapshot",
    });
    worker.addEventListener("message", (event: MessageEvent<AuditSnapshotWorkerResponse>) => {
      const message = event.data;
      if (message?.protocolVersion !== AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION || !message.requestId) return;
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      if (message.type === "audit-snapshot/prepared") request.resolve(message.result);
      else request.reject(new Error(message.message));
    });
    worker.addEventListener("error", () => resetWorker(new Error("Audit snapshot worker failed.")));
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

/** Use a module worker in browsers and a deterministic direct fallback in SSR/tests. */
export function prepareAnalysisSnapshotOffThread(
  snapshot: AnalysisSnapshot,
): Promise<PreparedAnalysisSnapshotTransport> {
  const activeWorker = getWorker();
  if (!activeWorker) return prepareAnalysisSnapshotTransport(snapshot);
  const requestId = `audit-snapshot-${Date.now()}-${++sequence}`;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const request: AuditSnapshotWorkerRequest = {
      protocolVersion: AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION,
      type: "audit-snapshot/prepare",
      requestId,
      snapshot,
    };
    try {
      activeWorker.postMessage(request);
    } catch (error) {
      pending.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function terminateAuditSnapshotWorker(): void {
  resetWorker(new Error("Audit snapshot worker terminated."));
}
