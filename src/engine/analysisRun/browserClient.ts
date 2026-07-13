import {
  ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
  type AnalysisRunProgressMessageV1,
  type AnalysisRunWorkerOutboundMessageV1,
} from "./executionProtocol";
import type {
  LegacyAnalysisRunExecutionResult,
  LegacyAnalysisRunInputV1,
} from "./legacyExecutor";

export interface AnalysisRunWorkerLike {
  onmessage: ((event: MessageEvent<AnalysisRunWorkerOutboundMessageV1>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface BrowserAnalysisRunTask {
  readonly requestId: string;
  readonly result: Promise<LegacyAnalysisRunExecutionResult>;
  readonly cancel: (reason?: string) => void;
}

export interface StartBrowserAnalysisRunOptions {
  readonly requestId: string;
  readonly input: LegacyAnalysisRunInputV1;
  readonly onProgress?: ((progress: AnalysisRunProgressMessageV1) => void) | undefined;
  /** Test/runtime seam. Production always receives the Vite worker factory. */
  readonly createWorker?: (() => AnalysisRunWorkerLike) | undefined;
}

/** Execute one pinned run in an isolated worker and release it on settlement. */
export function startBrowserAnalysisRun(
  options: StartBrowserAnalysisRunOptions,
): BrowserAnalysisRunTask {
  const worker = options.createWorker?.() ?? new Worker(
    new URL("./analysisRun.worker.ts", import.meta.url),
    { type: "module", name: "penman-analysis-run" },
  ) as AnalysisRunWorkerLike;
  let settled = false;
  let resolveResult!: (result: LegacyAnalysisRunExecutionResult) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<LegacyAnalysisRunExecutionResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    worker.terminate();
    callback();
  };

  worker.onmessage = (event: MessageEvent<AnalysisRunWorkerOutboundMessageV1>) => {
    const message = event.data;
    if (message.requestId != null && message.requestId !== options.requestId) return;
    if (message.type === "analysis-run/progress") {
      options.onProgress?.(message);
      return;
    }
    if (message.type === "analysis-run/result") {
      settle(() => resolveResult(message.result));
      return;
    }
    if (message.type === "analysis-run/cancelled") {
      settle(() => rejectResult(new Error(message.reason)));
      return;
    }
    if (message.type === "analysis-run/error") {
      settle(() => rejectResult(new Error(`${message.code}: ${message.message}`)));
    }
  };
  worker.onerror = (event: ErrorEvent) => {
    settle(() => rejectResult(new Error(event.message || "Analysis worker failed.")));
  };

  worker.postMessage({
    protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
    type: "analysis-run/execute",
    requestId: options.requestId,
    input: options.input,
  });

  return {
    requestId: options.requestId,
    result,
    cancel(reason = "Superseded by a newer analysis request.") {
      if (settled) return;
      worker.postMessage({
        protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
        type: "analysis-run/cancel",
        requestId: options.requestId,
        reason,
      });
    },
  };
}
