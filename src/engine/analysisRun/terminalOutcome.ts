import type { AnalysisTraceabilityEnvelope } from "../types";
import { ANALYSIS_STAGE_ORDER, type AnalysisStageId } from "./contracts";

/** A run's terminal outcome: the first stage that blocked or failed it. */
export interface TerminalOutcome {
  readonly kind: "blocked" | "failed";
  readonly stage: AnalysisStageId;
  readonly code: string;
  readonly message: string;
}

export function checkpointStage(level: AnalysisTraceabilityEnvelope["rigor"]["checkpoints"][number]["level"]): AnalysisStageId {
  switch (level) {
    case "syntactically-valid": return "fact-extraction";
    case "structurally-reconciled": return "structural-reconciliation";
    case "economically-plausible": return "economic-validation";
    case "valuation-eligible": return "model-execution";
    case "production-ready": return "release-trust";
  }
}

/**
 * The structural envelope is assembled by the legacy traceability builder,
 * while several native gates now run later in the AnalysisRun executor. Keep
 * the shared trust signal monotonic: a downstream fail-closed result may
 * demote trust, but it can never leave an earlier production-ready verdict in
 * place or manufacture an earlier rigor achievement.
 */
export function applyTerminalOutcomeToEnvelope(
  envelope: AnalysisTraceabilityEnvelope,
  terminal: TerminalOutcome | null,
): AnalysisTraceabilityEnvelope {
  if (!terminal) return envelope;

  const terminalStageIndex = ANALYSIS_STAGE_ORDER.indexOf(terminal.stage);
  let prefixCleared = true;
  const checkpoints = envelope.rigor.checkpoints.map((checkpoint) => {
    const checkpointIndex = ANALYSIS_STAGE_ORDER.indexOf(checkpointStage(checkpoint.level));
    const invalidatedByTerminal = checkpointIndex >= terminalStageIndex;
    const achieved = prefixCleared && checkpoint.achieved && !invalidatedByTerminal;
    if (!achieved) prefixCleared = false;
    return {
      ...checkpoint,
      achieved,
      detail: invalidatedByTerminal
        ? `${checkpoint.label} was not achieved because ${terminal.code}: ${terminal.message}`
        : checkpoint.detail,
    };
  });
  const achievedLevels = checkpoints.filter((checkpoint) => checkpoint.achieved).map((checkpoint) => checkpoint.level);
  const pendingLevels = checkpoints.filter((checkpoint) => !checkpoint.achieved).map((checkpoint) => checkpoint.level);
  const currentCheckpoint = [...checkpoints].reverse().find((checkpoint) => checkpoint.achieved) ?? checkpoints[0]!;
  const disposition = terminal.kind === "failed" ? "failed" : "blocked";

  return {
    ...envelope,
    confidence: {
      ...envelope.confidence,
      status: "blocked",
      tone: "red",
      headline: `Analysis run ${disposition} at ${terminal.stage}: ${terminal.message}`,
      blockingCount: Math.max(1, envelope.confidence.blockingCount + 1),
    },
    rigor: {
      currentLevel: currentCheckpoint.level,
      currentLabel: currentCheckpoint.label,
      summary: terminal.message,
      achievedLevels,
      pendingLevels,
      checkpoints,
    },
  };
}
