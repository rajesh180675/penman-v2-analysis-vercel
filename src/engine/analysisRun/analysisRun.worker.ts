/// <reference lib="webworker" />

import { executeLegacyAnalysisRun } from "./legacyExecutor";
import { attachAnalysisRunWorker, type AnalysisRunWorkerScope } from "./workerAdapter";

const scope = self as unknown as AnalysisRunWorkerScope;

attachAnalysisRunWorker(scope, async (input, cancellation) => {
  if (cancellation.isCancellationRequested()) {
    throw new Error("Analysis execution was cancelled before it started.");
  }
  return executeLegacyAnalysisRun(input);
});

export {};
