/**
 * S3-15 part 2 · evidence and drafts (decided by Shyam, 2026-10-16).
 *
 *   othersDraftIds      emissions among `ids` that are someone else's Draft:
 *                       for the caller they don't exist (documents can't be
 *                       attached to or removed from them)
 *   logLockedEvidence   attaching or removing a document on a row whose
 *                       site-month is closed stays allowed (it changes no
 *                       figure) but writes an audit_log row on the lock
 *                       (entity_type scope3_period_lock, action
 *                       evidence_added | evidence_removed, document and
 *                       emission ids only, never file names). Never throws.
 */
import type { EntityManager } from "typeorm";
import { log } from "../../utils/logger";

const ints = (list: unknown[]): number[] => [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

export const othersDraftIds = async (manager: EntityManager, ids: unknown[], userId: unknown): Promise<Set<number>> => {
  const list = ints(ids);
  if (!list.length) return new Set();
  const rows: Array<{ pk_id: number }> = await manager.query(
    `SELECT pk_id FROM emission WHERE pk_id = ANY($1::bigint[]) AND status::text = 'draft' AND created_by IS DISTINCT FROM $2`,
    [list, Number(userId) || 0],
  );
  return new Set(rows.map((r) => Number(r.pk_id)));
};

export interface EvidenceChange {
  document_id: number;
  emission_id: number;
}

export const logLockedEvidence = async (
  manager: EntityManager,
  changes: EvidenceChange[],
  action: "evidence_added" | "evidence_removed",
  userId: unknown,
): Promise<number> => {
  const list = changes.filter((c) => Number.isInteger(Number(c.document_id)) && Number(c.emission_id) > 0);
  if (!list.length) return 0;
  try {
    const hits: Array<{ document_id: number; emission_id: number; lock_id: number }> = await manager.query(
      `WITH p AS (SELECT DISTINCT * FROM unnest($1::int[], $2::bigint[]) AS p(document_id, emission_id))
       SELECT p.document_id, p.emission_id, l.id AS lock_id
         FROM p
         JOIN emission e ON e.pk_id = p.emission_id
         JOIN site s ON s.site_id = e.site_id
         JOIN company c ON c.company_id = s.company_id AND c.review_workflow_v2 = true
         JOIN LATERAL (
           SELECT l.id FROM period_lock l
            WHERE l.company_id = c.company_id AND (l.site_id = e.site_id OR l.site_id IS NULL)
              AND l.year = EXTRACT(YEAR FROM e.date_of_reporting)::int
              AND (l.month = EXTRACT(MONTH FROM e.date_of_reporting)::int OR l.month IS NULL)
              AND l.reopened_at IS NULL
            ORDER BY l.id LIMIT 1) l ON true`,
      [list.map((c) => Number(c.document_id)), list.map((c) => Number(c.emission_id))],
    );
    for (const h of hits) {
      const added = action === "evidence_added";
      await manager.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('scope3_period_lock', $1, $2, $3, NULL, $4)`,
        [
          h.lock_id,
          action,
          JSON.stringify({
            document_id: { old: added ? null : Number(h.document_id), new: added ? Number(h.document_id) : null },
            emission_id: { old: Number(h.emission_id), new: Number(h.emission_id) },
          }),
          Number(userId) || null,
        ],
      );
    }
    return hits.length;
  } catch (error) {
    log.error("Scope3Review", "Locked-month evidence log failed", { action, documentIds: list.map((c) => c.document_id).slice(0, 50), error: (error as Error).message });
    return 0;
  }
};
