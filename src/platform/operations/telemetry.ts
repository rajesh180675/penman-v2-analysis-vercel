import { scrubPII } from "../../lib/observability";

export interface PlatformTelemetryEvent {
  readonly eventName: string;
  readonly occurredAt: string;
  readonly durationMs: number | null;
  readonly status: "ok" | "warning" | "error";
  readonly organizationId: string | null;
  readonly workspaceId: string | null;
  readonly runId: string | null;
  readonly correlationId: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface PlatformTelemetrySink {
  emit(event: PlatformTelemetryEvent): Promise<void>;
}

export class InMemoryPlatformTelemetrySink implements PlatformTelemetrySink {
  readonly events: PlatformTelemetryEvent[] = [];
  async emit(event: PlatformTelemetryEvent): Promise<void> { this.events.push(Object.freeze(event)); }
}

export async function recordPlatformOperation<T>(input: {
  readonly sink: PlatformTelemetrySink;
  readonly eventName: string;
  readonly organizationId?: string | null;
  readonly workspaceId?: string | null;
  readonly runId?: string | null;
  readonly correlationId?: string | null;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly now?: () => number;
  readonly operation: () => Promise<T>;
}): Promise<T> {
  const now = input.now ?? Date.now;
  const started = now();
  try {
    const value = await input.operation();
    await input.sink.emit({ eventName: input.eventName, occurredAt: new Date().toISOString(), durationMs: Math.max(0, now() - started), status: "ok", organizationId: input.organizationId ?? null, workspaceId: input.workspaceId ?? null, runId: input.runId ?? null, correlationId: input.correlationId ?? null, attributes: scrubPII(input.attributes ?? {}) as Record<string, unknown> }).catch(() => undefined);
    return value;
  } catch (error) {
    await input.sink.emit({ eventName: input.eventName, occurredAt: new Date().toISOString(), durationMs: Math.max(0, now() - started), status: "error", organizationId: input.organizationId ?? null, workspaceId: input.workspaceId ?? null, runId: input.runId ?? null, correlationId: input.correlationId ?? null, attributes: scrubPII({ ...(input.attributes ?? {}), errorCode: error instanceof Error ? error.name : "unknown" }) as Record<string, unknown> }).catch(() => undefined);
    throw error;
  }
}
