import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { DatabaseConnection } from './connection.js';
import type { Schema } from './schema.js';

export type DrizzleTransaction = Parameters<
  Parameters<BetterSQLite3Database<Schema>['transaction']>[0]
>[0];

/**
 * Run a synchronous callback inside a SQLite transaction.
 *
 * The callback MUST be synchronous: better-sqlite3's transaction wrapper
 * rejects callbacks that return a Promise (`TypeError: Transaction function
 * cannot return a promise`). For SPEC §23.5 atomic writes that span multiple
 * repositories, use `Repositories.transact()` — it accepts the same sync shape.
 *
 * Async work (e.g., reading the result via an `async` repository) must happen
 * AFTER the transaction returns, on the outer `connection.db`.
 */
export function withTransaction<T>(
  connection: DatabaseConnection,
  fn: (tx: DrizzleTransaction) => T,
): T {
  return connection.db.transaction((tx) => fn(tx));
}
