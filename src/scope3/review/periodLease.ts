/**
 * S3-15 part 2 · write leases against the month lock.
 *
 * `lockPeriod` takes `pg_advisory_xact_lock(PERIOD_LOCK_CLASS, company)` and
 * re-checks completeness, but it can't see a write that passed the guard and
 * hasn't committed yet. A write therefore holds the same key SHARED from
 * before it checks the lock until it has finished: `lockPeriod` waits for
 * writes already in flight, and a write that starts after a lock committed
 * sees it and answers PERIOD_LOCKED.
 *
 * - `periodWriteLease` (HTTP routes, `guard.ts`): a session-level shared lock
 *   on a connection from a small pool of its own, released when the response
 *   ends. Its own pool: holding a main-pool connection while the handler
 *   needs another one could starve the main pool under load; here writes
 *   only queue for a lease.
 * - `lockPeriodsShared` (code already inside a transaction, e.g. an import
 *   commit): the transaction-scoped form on that transaction.
 *
 * Only companies with `review_workflow_v2` on are leased, so nothing changes
 * for a client without the review workflow.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import type { SiteMonth } from "./periodLock";

/** pg advisory lock class shared with `lockPeriod` / `unlockPeriod` (lock.ts). */
export const PERIOD_LOCK_CLASS = 3150;

/** Leases wait at most this long for a connection, then the write answers 500 rather than hang. */
const LEASE_CONNECT_TIMEOUT_MS = 10_000;

// The pieces of node-postgres used here (the repo has no @types/pg).
interface PoolClient {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
  release: (destroy?: boolean) => void;
}
interface Pool {
  connect: () => Promise<PoolClient>;
  on: (event: "error", listener: (err: Error) => void) => void;
}
interface PgDriver {
  /** TypeORM's main pool. */
  master?: { options?: Record<string, unknown> };
  /** The `pg` module TypeORM loaded. */
  postgres: { Pool: new (options: Record<string, unknown>) => Pool };
}

let pool: Pool | null = null;

/** The lease pool: the app's own connection settings (from TypeORM's pool), a few connections. */
const leasePool = (): Pool => {
  if (!pool) {
    const driver = AppDataSource.driver as unknown as PgDriver;
    const options = driver.master?.options ?? {};
    // node-postgres keeps `password` non-enumerable, so the spread alone would drop it.
    pool = new driver.postgres.Pool({ ...options, password: options.password, max: 5, connectionTimeoutMillis: LEASE_CONNECT_TIMEOUT_MS });
    pool.on("error", (err: Error) => console.error("[scope3] period lease pool error:", err.message));
  }
  return pool;
};

/** The companies with the review workflow on among the sites of `items` (sorted, each once). */
export const leasedCompanies = async (manager: EntityManager, items: Array<SiteMonth | null>): Promise<number[]> => {
  const siteIds = [...new Set(items.filter((i): i is SiteMonth => !!i).map((i) => i.site_id))];
  if (!siteIds.length) return [];
  const rows: Array<{ company_id: number }> = await manager.query(
    `SELECT DISTINCT c.company_id FROM site s JOIN company c ON c.company_id = s.company_id
      WHERE s.site_id = ANY($1::int[]) AND c.review_workflow_v2 = true ORDER BY c.company_id`,
    [siteIds],
  );
  return rows.map((r) => Number(r.company_id));
};

/** Inside a transaction: hold the companies' month-lock keys shared until it ends. */
export const lockPeriodsShared = async (tx: EntityManager, items: Array<SiteMonth | null>): Promise<void> => {
  for (const companyId of await leasedCompanies(tx, items)) {
    await tx.query(`SELECT pg_advisory_xact_lock_shared($1, $2)`, [PERIOD_LOCK_CLASS, companyId]);
  }
};

/** A held lease; `release` is safe to call more than once. */
export interface PeriodLease {
  release: () => Promise<void>;
}

const NO_LEASE: PeriodLease = { release: async () => {} };

/**
 * Takes the companies' month-lock keys shared on a lease connection. Call it
 * before checking for a lock; release it once the write is done (committed
 * or failed). No lease (and no connection) when no company has the switch on.
 */
export async function periodWriteLease(items: Array<SiteMonth | null>): Promise<PeriodLease> {
  const companies = await leasedCompanies(AppDataSource.manager, items);
  if (!companies.length) return NO_LEASE;
  const client: PoolClient = await leasePool().connect();
  const held: number[] = [];
  try {
    for (const companyId of companies) {
      await client.query(`SELECT pg_advisory_lock_shared($1, $2)`, [PERIOD_LOCK_CLASS, companyId]);
      held.push(companyId);
    }
  } catch (err) {
    client.release(true); // a dropped connection releases its session locks
    throw err;
  }
  let done = false;
  return {
    release: async () => {
      if (done) return;
      done = true;
      try {
        for (const companyId of held) await client.query(`SELECT pg_advisory_unlock_shared($1, $2)`, [PERIOD_LOCK_CLASS, companyId]);
        client.release();
      } catch (err) {
        console.error("[scope3] period lease release failed:", (err as Error).message);
        client.release(true);
      }
    },
  };
}

/** Runs `fn` under a write lease for `items`, released when it settles. */
export async function withPeriodWriteLease<T>(items: Array<SiteMonth | null>, fn: () => Promise<T>): Promise<T> {
  const lease = await periodWriteLease(items);
  try {
    return await fn();
  } finally {
    await lease.release();
  }
}
