/* ================================================================
   Plan 8 PR-8.1 — Cell-level annotation threads.

   Reviewers need to leave questions on specific numbers in a run
   ("why is ke 14% when peer median is 10%?") and have a thread of
   answers that survives across sessions and across reviewers.

   This module ships the data model + pure operations:
     cellPathOf(runId, surface, cellKey) -> stable identifier
     appendComment(thread, { authorId, body }) -> new thread state
     resolveThread(thread, { resolverId, resolution }) -> closed thread
     serializeThread / parseThread -> wire-format round-trip

   The pure surface lets us:
     - Test the thread state machine without KV mocking
     - Layer KV persistence on top in a follow-up PR (annotationsKvStore.ts)
     - Render UI against a deterministic state shape

   Why ship pure logic first, KV layer separately:
     - The thread shape is the contract reviewers + UI agree on
     - KV adapter is a thin wrapper; once shape is right, plumbing is mechanical
     - Same pattern PR-4.x followed (kvClient + identity, then per-feature stores)
================================================================ */

export interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface AnnotationThread {
  cellPath: string;
  comments: Comment[];
  resolved: boolean;
  resolverId?: string;
  resolution?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface AppendCommentInput {
  authorId: string;
  body: string;
}

export interface ResolveThreadInput {
  resolverId: string;
  resolution: string;
}

/* ----------------- cellPathOf --------------------------------- */

/**
 * Compose a stable identity for an annotated cell.
 * Format: `<runId>::<surface>::<cellKey>` — colon-pipe is rare in
 * runIds so this stays a clean key for KV scans.
 */
export function cellPathOf(runId: string, surface: string, cellKey: string): string {
  return `${runId}::${surface}::${cellKey}`;
}

/* ----------------- thread state operations -------------------- */

let counter = 0;
function newCommentId(): string {
  counter += 1;
  return `c-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function appendComment(thread: AnnotationThread, input: AppendCommentInput): AnnotationThread {
  const comment: Comment = {
    id: newCommentId(),
    authorId: input.authorId,
    body: input.body,
    createdAt: new Date().toISOString(),
  };
  // Re-open the thread when a new comment lands after resolution
  return {
    ...thread,
    comments: [...thread.comments, comment],
    resolved: false,
    resolverId: undefined,
    resolution: undefined,
    resolvedAt: undefined,
  };
}

export function resolveThread(thread: AnnotationThread, input: ResolveThreadInput): AnnotationThread {
  return {
    ...thread,
    resolved: true,
    resolverId: input.resolverId,
    resolution: input.resolution,
    resolvedAt: new Date().toISOString(),
  };
}

/* ----------------- wire format -------------------------------- */

export function serializeThread(thread: AnnotationThread): string {
  return JSON.stringify(thread);
}

export function parseThread(raw: string): AnnotationThread | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "cellPath" in parsed &&
      "comments" in parsed &&
      "resolved" in parsed &&
      "createdAt" in parsed
    ) {
      return parsed as AnnotationThread;
    }
    return null;
  } catch {
    return null;
  }
}
