import { reproducibilityHash } from "../../lib/evidenceLocking";
import type { Sha256Id } from "./contracts";

export const TRANSFORMATION_DAG_SCHEMA_VERSION = "transformation-dag-v1" as const;

export interface TransformationNodeCore {
  readonly transformationId: string;
  readonly functionId: string;
  readonly functionVersion: string;
  /** Order is semantic and therefore participates in node identity. */
  readonly inputFactIds: readonly string[];
  readonly outputFactIds: readonly string[];
  readonly policyRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly parameters: Readonly<Record<string, number | string | boolean | null>>;
}

export interface TransformationNode extends TransformationNodeCore {
  readonly nodeId: Sha256Id;
}

export interface TransformationDag {
  readonly schemaVersion: typeof TRANSFORMATION_DAG_SCHEMA_VERSION;
  readonly dagId: Sha256Id;
  readonly rootFactIds: readonly string[];
  readonly nodes: readonly TransformationNode[];
}

export interface TransformationDagError {
  readonly code: "DUPLICATE_NODE" | "DUPLICATE_OUTPUT" | "MISSING_INPUT" | "CYCLE" | "EMPTY_OUTPUT";
  readonly nodeId: string | null;
  readonly message: string;
}

export type TransformationDagResult =
  | { readonly ok: true; readonly value: TransformationDag }
  | { readonly ok: false; readonly errors: readonly [TransformationDagError, ...TransformationDagError[]] };

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) clone[key] = cloneAndFreeze(nested);
    return Object.freeze(clone) as unknown as T;
  }
  return value;
}

export async function createTransformationNode(core: TransformationNodeCore): Promise<TransformationNode> {
  const digest = await reproducibilityHash(core as unknown as Record<string, unknown>);
  return cloneAndFreeze({ ...core, nodeId: `sha256:${digest}` as Sha256Id });
}

export async function createTransformationDag(input: {
  readonly rootFactIds: readonly string[];
  readonly nodes: readonly TransformationNode[];
}): Promise<TransformationDagResult> {
  const errors: TransformationDagError[] = [];
  const nodes = [...input.nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const nodeIds = new Set<string>();
  const producerByFact = new Map<string, string>();
  for (const node of nodes) {
    if (nodeIds.has(node.nodeId)) errors.push({ code: "DUPLICATE_NODE", nodeId: node.nodeId, message: "Node id appears more than once." });
    nodeIds.add(node.nodeId);
    if (node.outputFactIds.length === 0) errors.push({ code: "EMPTY_OUTPUT", nodeId: node.nodeId, message: "A transformation must declare at least one output fact." });
    for (const output of node.outputFactIds) {
      const prior = producerByFact.get(output);
      if (prior) errors.push({ code: "DUPLICATE_OUTPUT", nodeId: node.nodeId, message: `Fact ${output} is already produced by ${prior}.` });
      else producerByFact.set(output, node.nodeId);
    }
  }
  const roots = new Set(input.rootFactIds);
  const dependencies = new Map<string, Set<string>>();
  for (const node of nodes) {
    const deps = new Set<string>();
    for (const inputFact of node.inputFactIds) {
      const producer = producerByFact.get(inputFact);
      if (producer) deps.add(producer);
      else if (!roots.has(inputFact)) errors.push({ code: "MISSING_INPUT", nodeId: node.nodeId, message: `Input fact ${inputFact} is neither a root nor a produced fact.` });
    }
    dependencies.set(node.nodeId, deps);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    const cyclic = [...(dependencies.get(nodeId) ?? [])].some(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
    return cyclic;
  };
  for (const node of nodes) {
    if (visit(node.nodeId)) {
      errors.push({ code: "CYCLE", nodeId: node.nodeId, message: "Transformation dependencies contain a cycle." });
      break;
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors as [TransformationDagError, ...TransformationDagError[]] };
  const content = {
    schemaVersion: TRANSFORMATION_DAG_SCHEMA_VERSION,
    rootFactIds: [...input.rootFactIds].sort(),
    nodes,
  };
  const digest = await reproducibilityHash(content as unknown as Record<string, unknown>);
  return { ok: true, value: cloneAndFreeze({ ...content, dagId: `sha256:${digest}` as Sha256Id }) };
}

export class TransformationRecorder {
  private readonly roots = new Set<string>();
  private readonly nodes: TransformationNode[] = [];

  addRootFact(factId: string): void {
    this.roots.add(factId);
  }

  async record(core: TransformationNodeCore): Promise<TransformationNode> {
    const node = await createTransformationNode(core);
    this.nodes.push(node);
    return node;
  }

  finalize(): Promise<TransformationDagResult> {
    return createTransformationDag({ rootFactIds: [...this.roots], nodes: this.nodes });
  }
}
