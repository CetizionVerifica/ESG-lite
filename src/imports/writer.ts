/**
 * EmissionWriter interface and the batch-committed hook (IM0).
 * See docs/mcp-import/01-contracts.md §6 and §7.
 *
 * IM1 implements `EmissionWriter` (src/services/emissionWrite). IM2 consumes
 * it: part 1 behind a fake writer, part 2 wired to IM1. `createEmission`
 * (typed entry) uses the same writer for one row, so typed and imported
 * totals are equal by construction.
 */
import type { EntityManager } from "typeorm";
import type { ActivityMatch, ImportChannel, ImportRow, PlannedRow } from "./contracts";

export interface WriterContext {
  user_id: number;
  role: string;
  company_id: number;
  /** Sites the caller may write to. */
  allowed_site_ids: number[];
  /** Per site, the categories the caller may write to (a User's own categories; all assigned for other roles). */
  allowed_category_ids_by_site: Record<number, number[]>;
}

export interface BatchInfo {
  upload_batch_id: string;
  channel: ImportChannel;
  source_name: string;
}

export interface InsertResult {
  inserted: number;
  fera_inserted: number;
  ids: number[];
}

export interface EmissionWriter {
  /**
   * Pure of side effects: resolves activity, factor, unit and calc spec,
   * computes totals and FERA twins, checks scope, mode lock and duplicates.
   * Returns one PlannedRow per input row, in the same order.
   */
  planRows(ctx: WriterContext, rows: ImportRow[], opts: { planMatches: ActivityMatch[] }): Promise<PlannedRow[]>;
  /**
   * Inside the caller's transaction: inserts the ready rows (+ FERA twins,
   * linked both ways) and their audit rows, status pending, and returns ids.
   */
  insertRows(tx: EntityManager, ctx: WriterContext, rows: PlannedRow[], batch: BatchInfo): Promise<InsertResult>;
}

// ---------------------------------------------------------------------------
// §7 Batch committed hook (IM2 emits after the commit transaction, IM4 listens)
// ---------------------------------------------------------------------------

export interface BatchCommittedEvent {
  upload_batch_id: string;
  company_id: number;
  created_by: number;
  /** The user who committed the plan (may differ from its creator). Optional: the internal python route predates it. */
  committed_by?: number;
  channel: ImportChannel;
  source_name: string;
  site_ids: number[];
  rows: number;
  tco2e: number;
  /** "YYYY-MM" months covered by the batch. */
  months: string[];
}

export type BatchCommittedListener = (event: BatchCommittedEvent) => void | Promise<void>;

const listeners = new Set<BatchCommittedListener>();

/** Register a listener. Returns a function that removes it. */
export const onBatchCommitted = (listener: BatchCommittedListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Notify listeners after a commit has succeeded. Listener errors are logged
 * and never undo the commit; every listener runs even if one throws.
 */
export const emitBatchCommitted = async (event: BatchCommittedEvent): Promise<void> => {
  for (const listener of [...listeners]) {
    try {
      await listener(event);
    } catch (err) {
      console.error(`Batch-committed listener failed for batch ${event.upload_batch_id}:`, err instanceof Error ? err.message : err);
    }
  }
};

/** Test helper: drop every listener (an in-memory Set, no data involved). */
export const clearBatchCommittedListeners = (): void => {
  for (const listener of [...listeners]) listeners.delete(listener);
};
