/// <reference lib="webworker" />

import { attachAuditSnapshotWorker, type AuditSnapshotWorkerScope } from "./auditSnapshotWorkerProtocol";

attachAuditSnapshotWorker(self as unknown as AuditSnapshotWorkerScope);

export {};
