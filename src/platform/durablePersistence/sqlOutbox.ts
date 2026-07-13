import type { TransactionalSqlDriver } from "./contracts";

export interface PlatformOutboxMessage {
  readonly organizationId: string; readonly workspaceId: string; readonly messageId: string;
  readonly topic: string; readonly aggregateId: string; readonly payload: unknown; readonly attemptCount: number;
}

export interface PlatformOutboxSink { deliver(message: PlatformOutboxMessage): Promise<void>; }

interface OutboxRow extends Record<string, unknown> {
  readonly organization_id: string; readonly workspace_id: string; readonly message_id: string;
  readonly topic: string; readonly aggregate_id: string; readonly payload_json: unknown; readonly attempt_count: number;
}

/** Lease-based at-least-once outbox dispatcher. Sinks must deduplicate by messageId. */
export class SqlOutboxDispatcher {
  constructor(private readonly driver: TransactionalSqlDriver, private readonly sink: PlatformOutboxSink) {}

  async dispatchBatch(input: { readonly workerId: string; readonly now: string; readonly limit?: number }): Promise<{ readonly delivered: number; readonly failed: number }> {
    const limit = input.limit ?? 50;
    if (!input.workerId || !Number.isFinite(Date.parse(input.now)) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid outbox dispatch request.");
    const rows = await this.driver.transaction(async (tx) => {
      const selected = await tx.query<OutboxRow>(
        `select organization_id, workspace_id, message_id, topic, aggregate_id, payload_json, attempt_count
         from platform_outbox where delivered_at is null and available_at <= $1
           and (locked_at is null or locked_at < $1::timestamptz - interval '5 minutes')
         order by created_at asc limit $2 for update skip locked`, [input.now, limit],
      );
      for (const row of selected.rows) await tx.query(
        "update platform_outbox set locked_at = $1, locked_by = $2 where organization_id = $3 and workspace_id = $4 and message_id = $5",
        [input.now, input.workerId, row.organization_id, row.workspace_id, row.message_id],
      );
      return selected.rows;
    });
    let delivered = 0; let failed = 0;
    for (const row of rows) {
      const message: PlatformOutboxMessage = {
        organizationId: row.organization_id, workspaceId: row.workspace_id, messageId: row.message_id,
        topic: row.topic, aggregateId: row.aggregate_id,
        payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json,
        attemptCount: Number(row.attempt_count),
      };
      try {
        await this.sink.deliver(message); delivered += 1;
        await this.driver.query(
          "update platform_outbox set delivered_at = $1, locked_at = null, locked_by = null, last_error = null where organization_id = $2 and workspace_id = $3 and message_id = $4 and locked_by = $5",
          [input.now, row.organization_id, row.workspace_id, row.message_id, input.workerId],
        );
      } catch (error) {
        failed += 1;
        const nextAttempt = Number(row.attempt_count) + 1;
        const delaySeconds = Math.min(3_600, 2 ** Math.min(nextAttempt, 10));
        await this.driver.query(
          `update platform_outbox set attempt_count = attempt_count + 1, last_error = $1, locked_at = null, locked_by = null,
             available_at = $2::timestamptz + ($3 * interval '1 second')
           where organization_id = $4 and workspace_id = $5 and message_id = $6 and locked_by = $7`,
          [error instanceof Error ? error.message.slice(0, 1_000) : "Delivery failed", input.now, delaySeconds, row.organization_id, row.workspace_id, row.message_id, input.workerId],
        );
      }
    }
    return { delivered, failed };
  }
}
