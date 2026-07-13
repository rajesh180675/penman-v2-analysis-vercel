import type { AtomicRunLifecycleCoordinator } from "../atomicRunLifecycle";
import { SqlAnalysisRunRepository } from "./sqlAnalysisRunRepository";
import { SqlArtifactRepository } from "./sqlArtifactRepository";
import { SqlRunOperationsRepository } from "./sqlRunOperationsRepository";
import type { DurableObjectStore, SqlTransaction, TransactionalSqlDriver } from "./contracts";

async function enqueue(transaction: SqlTransaction, input: { readonly context: Parameters<AtomicRunLifecycleCoordinator["createRunAndAppendEvent"]>[0]["context"]; readonly event: { readonly eventId: string; readonly runId: string; readonly eventType: string } }): Promise<void> {
  await transaction.query(
    `insert into platform_outbox (organization_id, workspace_id, message_id, topic, aggregate_id, payload_json)
     values ($1,$2,$3,$4,$5,$6::jsonb) on conflict do nothing`,
    [input.context.scope.organizationId, input.context.scope.workspaceId, input.event.eventId, `analysis-run.${input.event.eventType}`, input.event.runId, JSON.stringify(input.event)],
  );
}

function nestedDriver(transaction: SqlTransaction): TransactionalSqlDriver {
  return {
    dialect: "postgres-compatible",
    query: transaction.query.bind(transaction),
    transaction: async (operation) => operation(transaction),
  };
}

/** Commits lifecycle metadata, audit receipts/events, locks, and holds in one SQL transaction. */
export class SqlAtomicRunLifecycleCoordinator implements AtomicRunLifecycleCoordinator {
  constructor(private readonly driver: TransactionalSqlDriver, private readonly objects: DurableObjectStore) {}

  async createRunAndAppendEvent(input: Parameters<AtomicRunLifecycleCoordinator["createRunAndAppendEvent"]>[0]) {
    return this.driver.transaction(async (transaction) => {
      const driver = nestedDriver(transaction);
      const versioned = await new SqlAnalysisRunRepository(driver).create(input.context, input.draft, input.runIdempotencyKey);
      await new SqlRunOperationsRepository(driver).appendEvent(input.context, { ...input.event, runRevision: versioned.revision }, input.eventIdempotencyKey);
      await enqueue(transaction, { context: input.context, event: input.event });
      return versioned;
    });
  }

  async finalizeRunAndAppendEvent(input: Parameters<AtomicRunLifecycleCoordinator["finalizeRunAndAppendEvent"]>[0]) {
    return this.driver.transaction(async (transaction) => {
      const driver = nestedDriver(transaction);
      const versioned = await new SqlAnalysisRunRepository(driver).finalize(input.context, input.runId, input.expectedRevision);
      await new SqlRunOperationsRepository(driver).appendEvent(input.context, { ...input.event, runRevision: versioned.revision }, input.eventIdempotencyKey);
      await enqueue(transaction, { context: input.context, event: input.event });
      return versioned;
    });
  }

  async lockRunAndAppendEvent(input: Parameters<AtomicRunLifecycleCoordinator["lockRunAndAppendEvent"]>[0]) {
    return this.driver.transaction(async (transaction) => {
      const driver = nestedDriver(transaction);
      await new SqlArtifactRepository(driver, this.objects).applyRetentionHold(input.context, input.refs, input.holdId);
      const operations = new SqlRunOperationsRepository(driver);
      const lock = await operations.lockRun(input.context, input.lock);
      await operations.appendEvent(input.context, input.event, input.eventIdempotencyKey);
      await enqueue(transaction, { context: input.context, event: input.event });
      return lock;
    });
  }
}
