import { describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
  createAnalysisRunExecutionController,
  type AnalysisRunWorkerOutboundMessageV1,
  type LegacyAnalysisRunExecutionResult,
  type LegacyAnalysisRunInputV1,
} from "../index";

const input = {} as LegacyAnalysisRunInputV1;
const completed = {
  status: "completed",
  run: {},
  artifacts: [],
  diagnostics: [],
  materialization: {},
} as unknown as LegacyAnalysisRunExecutionResult;

describe("AnalysisRun execution protocol", () => {
  it("emits ordered accepted, started, settled, and result messages and executes once", async () => {
    const emitted: AnalysisRunWorkerOutboundMessageV1[] = [];
    const executor = vi.fn(async () => completed);
    const controller = createAnalysisRunExecutionController({ executor, emit: (message) => emitted.push(message) });
    controller.handle({
      protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
      type: "analysis-run/execute",
      requestId: "request-1",
      input,
    });
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(executor).toHaveBeenCalledTimes(1);
    expect(emitted.map((message) => message.type)).toEqual([
      "analysis-run/progress",
      "analysis-run/progress",
      "analysis-run/progress",
      "analysis-run/result",
    ]);
    const sequences = emitted
      .filter((message) => message.type === "analysis-run/progress")
      .map((message) => message.sequence);
    expect(sequences).toEqual([0, 1, 2]);
  });

  it("cancels a queued request before the executor starts", async () => {
    const emitted: AnalysisRunWorkerOutboundMessageV1[] = [];
    const scheduled: Array<() => void> = [];
    const executor = vi.fn(async () => completed);
    const controller = createAnalysisRunExecutionController({
      executor,
      emit: (message) => emitted.push(message),
      schedule: (task) => scheduled.push(task),
    });
    controller.handle({ protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION, type: "analysis-run/execute", requestId: "request-2", input });
    controller.handle({ protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION, type: "analysis-run/cancel", requestId: "request-2", reason: "No longer needed" });
    scheduled[0]!();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(executor).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toEqual(expect.objectContaining({ type: "analysis-run/cancelled", reason: "No longer needed" }));
  });
});
