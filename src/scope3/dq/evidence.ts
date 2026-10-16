/**
 * S3-3 · Keeps a row's data quality honest when its evidence changes after the
 * row was saved (§3: "When evidence is attached after save, recompute DQ
 * reliability only. The total is untouched.").
 *
 * Reliability is the one indicator evidence speaks to: a row with no document
 * can't score better than fair, and attaching one lifts a specific method to
 * good. Removing the last document lowers it again, so the score never claims
 * more than the row can show.
 *
 * Nothing else is recalculated and no total is read, let alone written.
 */
import type { EntityManager } from "typeorm";
import { Emission } from "../../entities/Emission";
import { dqWithEvidence } from "./defaults";

/** Rows whose data quality may need its reliability reconsidered. */
export const refreshDqForEvidence = async (manager: EntityManager, emissionIds: number[]): Promise<number> => {
  const ids = [...new Set(emissionIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return 0;

  const repo = manager.getRepository(Emission);
  const rows = await repo.find({ where: ids.map((pk_id) => ({ pk_id })), select: ["pk_id", "method", "dq"] });

  let changed = 0;
  for (const row of rows) {
    // No method means a Scope 1 or Scope 2 row, which carries no quality at
    // all; a quality somebody entered by hand is theirs, not ours to move.
    if (!row.method || !row.dq || row.dq.source === "manual") continue;

    const [{ count }]: Array<{ count: string }> = await manager.query(
      `SELECT count(*)::text AS count FROM emission_document WHERE emission_id = $1`,
      [row.pk_id],
    );
    const next = dqWithEvidence(row.dq, row.method, Number(count) > 0);
    if (next.reliability === row.dq.reliability && next.overall === row.dq.overall) continue;

    await repo.update({ pk_id: row.pk_id }, { dq: next });
    changed += 1;
  }
  return changed;
};

/**
 * The same, for a request that must not fail because of it: the document was
 * saved either way, so a quality refresh that breaks is logged with ids only
 * and the upload still answers. Never swallowed silently.
 */
export const refreshDqForEvidenceSafely = async (
  manager: EntityManager,
  emissionIds: Array<number | string | null | undefined>,
): Promise<void> => {
  const ids = emissionIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return;
  try {
    await refreshDqForEvidence(manager, ids);
  } catch (err) {
    console.error(`[S3-3] Could not refresh data quality after an evidence change for entries ${ids.join(", ")}:`, err);
  }
};
