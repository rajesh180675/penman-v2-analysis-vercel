import type { SqlQueryResult, SqlTransaction, TransactionalSqlDriver } from "../../src/platform/durablePersistence";

export interface PostgresClientLike {
  query(text: string, parameters?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number | null }>;
  release(): void;
}

export interface PostgresPoolLike {
  query(text: string, parameters?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number | null }>;
  connect(): Promise<PostgresClientLike>;
}

function result(value: { readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number | null }): SqlQueryResult {
  return { rows: value.rows, rowCount: value.rowCount ?? value.rows.length };
}

/** Adapts pg-compatible pools without coupling the domain package to a vendor SDK. */
export class PostgresPoolDriver implements TransactionalSqlDriver {
  readonly dialect = "postgres-compatible" as const;
  constructor(private readonly pool: PostgresPoolLike) {}

  async query<TRow extends Record<string, unknown> = Record<string, unknown>>(text: string, parameters?: readonly unknown[]): Promise<SqlQueryResult<TRow>> {
    return result(await this.pool.query(text, parameters)) as SqlQueryResult<TRow>;
  }

  async transaction<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const transaction: SqlTransaction = {
        query: async <TRow extends Record<string, unknown> = Record<string, unknown>>(text: string, parameters?: readonly unknown[]) => result(await client.query(text, parameters)) as SqlQueryResult<TRow>,
      };
      const value = await operation(transaction);
      await client.query("commit");
      return value;
    } catch (error) {
      try { await client.query("rollback"); } catch { /* Preserve the original transaction failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
