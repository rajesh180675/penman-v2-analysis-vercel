import {
  ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
  createAnalysisRunExecutionController,
  isAnalysisRunWorkerInboundMessage,
  type AnalysisRunExecutor,
  type AnalysisRunProtocolErrorMessageV1,
  type AnalysisRunWorkerOutboundMessageV1,
} from "./executionProtocol";

export interface AnalysisRunWorkerScope {
  readonly postMessage: (message: AnalysisRunWorkerOutboundMessageV1) => void;
  readonly addEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
}

/** Thin runtime adapter; analytical orchestration remains in the injected executor. */
export function attachAnalysisRunWorker(
  scope: AnalysisRunWorkerScope,
  executor: AnalysisRunExecutor,
): () => void {
  const controller = createAnalysisRunExecutionController({
    executor,
    emit: (message) => scope.postMessage(message),
  });
  const listener = (event: { readonly data: unknown }) => {
    if (!isAnalysisRunWorkerInboundMessage(event.data)) {
      const error: AnalysisRunProtocolErrorMessageV1 = {
        protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
        type: "analysis-run/error",
        requestId: null,
        code: "INVALID_MESSAGE",
        message: "Worker message does not match the analysis-run protocol.",
      };
      scope.postMessage(error);
      return;
    }
    controller.handle(event.data);
  };
  scope.addEventListener("message", listener);
  return () => scope.removeEventListener("message", listener);
}
