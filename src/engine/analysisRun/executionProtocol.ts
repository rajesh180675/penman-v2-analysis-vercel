import type { AnalysisStageId } from "./contracts";
import type {
  LegacyAnalysisRunExecutionResult,
  LegacyAnalysisRunInputV1,
} from "./legacyExecutor";

export const ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION = "2026-07-analysis-run-execution-v1" as const;

export type AnalysisRunExecutionState =
  | "queued"
  | "running"
  | "cancellation-requested"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface AnalysisRunExecuteMessageV1 {
  readonly protocolVersion: typeof ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION;
  readonly type: "analysis-run/execute";
  readonly requestId: string;
  readonly input: LegacyAnalysisRunInputV1;
}

export interface AnalysisRunCancelMessageV1 {
  readonly protocolVersion: typeof ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION;
  readonly type: "analysis-run/cancel";
  readonly requestId: string;
  readonly reason?: string | undefined;
}

export type AnalysisRunWorkerInboundMessageV1 =
  | AnalysisRunExecuteMessageV1
  | AnalysisRunCancelMessageV1;

export interface AnalysisRunProgressMessageV1 {
  readonly protocolVersion: typeof ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION;
  readonly type: "analysis-run/progress";
  readonly requestId: string;
  readonly sequence: number;
  readonly phase: "accepted" | "started" | "cancellation-requested" | "settled";
  readonly state: AnalysisRunExecutionState;
  readonly stageId: AnalysisStageId;
  readonly message: string;
}

export interface AnalysisRunResultMessageV1 {
  readonly protocolVersion: typeof ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION;
  readonly type: "analysis-run/result";
  readonly requestId: string;
  readonly result: LegacyAnalysisRunExecutionResult;
}

export interface AnalysisRunCancelledMessageV1 {
  readonly protocolVersion: typeof ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION;
  readonly type: "analysis-run/cancelled";
  readonly requestId: string;
  readonly reason: string;
}

export interface AnalysisRunProtocolErrorMessageV1 {
  readonly protocolVersion: typeof ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION;
  readonly type: "analysis-run/error";
  readonly requestId: string | null;
  readonly code:
    | "INVALID_MESSAGE"
    | "DUPLICATE_REQUEST_ID"
    | "REQUEST_NOT_FOUND"
    | "REQUEST_ALREADY_SETTLED"
    | "EXECUTOR_REJECTED";
  readonly message: string;
}

export type AnalysisRunWorkerOutboundMessageV1 =
  | AnalysisRunProgressMessageV1
  | AnalysisRunResultMessageV1
  | AnalysisRunCancelledMessageV1
  | AnalysisRunProtocolErrorMessageV1;

export interface AnalysisRunExecutionSnapshot {
  readonly requestId: string;
  readonly state: AnalysisRunExecutionState;
  readonly nextSequence: number;
  readonly cancellationReason: string | null;
}

export interface AnalysisRunCancellationContext {
  readonly isCancellationRequested: () => boolean;
}

export type AnalysisRunExecutor = (
  input: LegacyAnalysisRunInputV1,
  context: AnalysisRunCancellationContext,
) => Promise<LegacyAnalysisRunExecutionResult>;

export type AnalysisRunTaskScheduler = (task: () => void) => void;

interface MutableExecutionState {
  requestId: string;
  state: AnalysisRunExecutionState;
  nextSequence: number;
  cancellationReason: string | null;
  lastStageId: AnalysisStageId;
}

export interface AnalysisRunExecutionController {
  readonly handle: (message: AnalysisRunWorkerInboundMessageV1) => void;
  readonly getSnapshot: (requestId: string) => AnalysisRunExecutionSnapshot | null;
}

function defaultScheduler(task: () => void): void {
  queueMicrotask(task);
}

function messageForResult(result: LegacyAnalysisRunExecutionResult): string {
  if (result.status === "completed") return "Analysis run completed.";
  if (result.status === "blocked") return `Analysis run blocked: ${result.reasonCode}.`;
  return `Analysis run failed: ${result.errorCode}.`;
}

/**
 * Platform-neutral request controller. It knows nothing about Worker globals;
 * a worker, CLI, or test harness supplies only an emitter and an executor.
 *
 * Cancellation is cooperative. A queued request is prevented from starting.
 * The synchronous legacy pipeline cannot be pre-empted after it starts, so a
 * late cancellation suppresses its eventual result and settles as cancelled.
 */
export function createAnalysisRunExecutionController(params: {
  executor: AnalysisRunExecutor;
  emit: (message: AnalysisRunWorkerOutboundMessageV1) => void;
  schedule?: AnalysisRunTaskScheduler | undefined;
}): AnalysisRunExecutionController {
  const states = new Map<string, MutableExecutionState>();
  const schedule = params.schedule ?? defaultScheduler;
  const cancellationRequested = (state: MutableExecutionState) =>
    state.state === "cancellation-requested";

  const emitProgress = (
    state: MutableExecutionState,
    phase: AnalysisRunProgressMessageV1["phase"],
    stageId: AnalysisStageId,
    message: string,
  ) => {
    state.lastStageId = stageId;
    params.emit({
      protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
      type: "analysis-run/progress",
      requestId: state.requestId,
      sequence: state.nextSequence,
      phase,
      state: state.state,
      stageId,
      message,
    });
    state.nextSequence += 1;
  };

  const emitError = (
    requestId: string | null,
    code: AnalysisRunProtocolErrorMessageV1["code"],
    message: string,
  ) => params.emit({
    protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
    type: "analysis-run/error",
    requestId,
    code,
    message,
  });

  const settleCancelled = (state: MutableExecutionState) => {
    state.state = "cancelled";
    emitProgress(state, "settled", state.lastStageId, "Analysis run cancelled.");
    params.emit({
      protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
      type: "analysis-run/cancelled",
      requestId: state.requestId,
      reason: state.cancellationReason ?? "Cancellation requested.",
    });
  };

  const start = async (state: MutableExecutionState, input: LegacyAnalysisRunInputV1) => {
    if (cancellationRequested(state)) {
      settleCancelled(state);
      return;
    }
    state.state = "running";
    emitProgress(state, "started", "artifact-ingestion", "Legacy-backed analysis execution started.");
    try {
      const result = await params.executor(input, {
        isCancellationRequested: () => cancellationRequested(state),
      });
      if (cancellationRequested(state)) {
        settleCancelled(state);
        return;
      }
      state.state = result.status;
      emitProgress(state, "settled", "release-trust", messageForResult(result));
      params.emit({
        protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
        type: "analysis-run/result",
        requestId: state.requestId,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cancellationRequested(state)) {
        settleCancelled(state);
        return;
      }
      state.state = "failed";
      emitProgress(state, "settled", "release-trust", "Analysis executor rejected unexpectedly.");
      emitError(state.requestId, "EXECUTOR_REJECTED", message);
    }
  };

  const handleExecute = (message: AnalysisRunExecuteMessageV1) => {
    if (states.has(message.requestId)) {
      emitError(message.requestId, "DUPLICATE_REQUEST_ID", "Each execution requestId may be submitted only once.");
      return;
    }
    const state: MutableExecutionState = {
      requestId: message.requestId,
      state: "queued",
      nextSequence: 0,
      cancellationReason: null,
      lastStageId: "request-validation",
    };
    states.set(message.requestId, state);
    emitProgress(state, "accepted", "request-validation", "Analysis request accepted and queued.");
    schedule(() => { void start(state, message.input); });
  };

  const handleCancel = (message: AnalysisRunCancelMessageV1) => {
    const state = states.get(message.requestId);
    if (!state) {
      emitError(message.requestId, "REQUEST_NOT_FOUND", "No execution request exists for this requestId.");
      return;
    }
    if (["completed", "blocked", "failed", "cancelled"].includes(state.state)) {
      emitError(message.requestId, "REQUEST_ALREADY_SETTLED", `Execution request is already ${state.state}.`);
      return;
    }
    if (state.state === "cancellation-requested") return;
    state.state = "cancellation-requested";
    state.cancellationReason = message.reason?.trim() || "Cancellation requested by caller.";
    emitProgress(state, "cancellation-requested", state.lastStageId, state.cancellationReason);
  };

  return {
    handle(message) {
      if (message.type === "analysis-run/execute") handleExecute(message);
      else handleCancel(message);
    },
    getSnapshot(requestId) {
      const state = states.get(requestId);
      if (!state) return null;
      return Object.freeze({
        requestId: state.requestId,
        state: state.state,
        nextSequence: state.nextSequence,
        cancellationReason: state.cancellationReason,
      });
    },
  };
}

export function isAnalysisRunWorkerInboundMessage(
  value: unknown,
): value is AnalysisRunWorkerInboundMessageV1 {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AnalysisRunWorkerInboundMessageV1>;
  if (candidate.protocolVersion !== ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION) return false;
  if (typeof candidate.requestId !== "string" || candidate.requestId.trim().length === 0) return false;
  if (candidate.type === "analysis-run/cancel") return true;
  return candidate.type === "analysis-run/execute"
    && candidate.input !== null
    && typeof candidate.input === "object";
}
