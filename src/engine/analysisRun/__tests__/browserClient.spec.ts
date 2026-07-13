import { describe, expect, it, vi } from "vitest";
import {
  startBrowserAnalysisRun,
  type AnalysisRunWorkerLike,
} from "../browserClient";
import { ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION } from "../executionProtocol";
import type { LegacyAnalysisRunExecutionResult, LegacyAnalysisRunInputV1 } from "../legacyExecutor";

class FakeWorker implements AnalysisRunWorkerLike {
  onmessage: AnalysisRunWorkerLike["onmessage"] = null;
  onerror: AnalysisRunWorkerLike["onerror"] = null;
  readonly sent: unknown[] = [];
  readonly terminate = vi.fn();

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  emit(message: Parameters<NonNullable<AnalysisRunWorkerLike["onmessage"]>>[0]["data"]): void {
    this.onmessage?.({ data: message } as MessageEvent<typeof message>);
  }
}

const INPUT = { metadata: { runId: "run-1" } } as LegacyAnalysisRunInputV1;

describe("startBrowserAnalysisRun", () => {
  it("sends the versioned request, relays progress, and settles exactly once", async () => {
    const worker = new FakeWorker();
    const onProgress = vi.fn();
    const task = startBrowserAnalysisRun({
      requestId: "request-1",
      input: INPUT,
      onProgress,
      createWorker: () => worker,
    });
    expect(worker.sent[0]).toMatchObject({
      protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
      type: "analysis-run/execute",
      requestId: "request-1",
    });

    worker.emit({
      protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
      type: "analysis-run/progress",
      requestId: "request-1",
      sequence: 0,
      phase: "started",
      state: "running",
      stageId: "artifact-ingestion",
      message: "started",
    });
    expect(onProgress).toHaveBeenCalledOnce();

    const execution = { status: "completed" } as LegacyAnalysisRunExecutionResult;
    worker.emit({
      protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
      type: "analysis-run/result",
      requestId: "request-1",
      result: execution,
    });
    await expect(task.result).resolves.toBe(execution);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("requests cooperative cancellation and rejects on acknowledgement", async () => {
    const worker = new FakeWorker();
    const task = startBrowserAnalysisRun({ requestId: "request-2", input: INPUT, createWorker: () => worker });
    task.cancel("newer run");
    expect(worker.sent[1]).toMatchObject({ type: "analysis-run/cancel", reason: "newer run" });
    worker.emit({
      protocolVersion: ANALYSIS_RUN_EXECUTION_PROTOCOL_VERSION,
      type: "analysis-run/cancelled",
      requestId: "request-2",
      reason: "newer run",
    });
    await expect(task.result).rejects.toThrow("newer run");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
