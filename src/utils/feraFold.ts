// The approvals list folds a pending FERA twin into its partner entry while
// that partner is pending too: one row, one decision (approving the parent
// approves its pending twin). A pending twin whose partner is not pending
// (approved, rejected or gone) has no row to fold into and needs its own
// review, so it counts on its own.
//
// SQL condition for "this row is a pending FERA twin folded into a pending
// partner". `e` is the emission alias, `c` its category alias.
// The partner is the linked non-FERA entry at the same site, either
// direction of the link (feraPartnerStatuses below reads it the same way).
export const foldedFeraTwinSql = (e: string, c: string): string =>
  `(${e}.status = 'pending' AND LOWER(${c}.category_name) = 'fera' AND EXISTS (
     SELECT 1 FROM emission fp
       JOIN category fpc ON fpc.category_id = fp.category_id
      WHERE (fp.pk_id = ${e}.fera_linked_id OR fp.fera_linked_id = ${e}.pk_id)
        AND fp.pk_id <> ${e}.pk_id AND fp.site_id = ${e}.site_id
        AND LOWER(fpc.category_name) <> 'fera' AND fp.status = 'pending'))`;

// Entries waiting for review as the approvals list shows them.
export const pendingReviewCountSql = (e: string, c: string): string =>
  `COUNT(*) FILTER (WHERE ${e}.status = 'pending' AND NOT ${foldedFeraTwinSql(e, c)})`;

type FeraRow = { pk_id: number; fera_linked_id?: number | null; category?: { category_name?: string } | null };

const isFera = (row: FeraRow): boolean => row.category?.category_name?.toLowerCase() === "fera";

/**
 * Adds `parent_category_name` and `fera_partner_status` to the FERA rows of a
 * list page. The approvals list shows a pending twin on its own only when its
 * partner is not pending: a partner on another page or outside the filters
 * is still the row that carries the decision (approving it approves the twin).
 */
export const enrichFeraRows = async (
  rows: FeraRow[],
  query: (sql: string, params: unknown[]) => Promise<any[]>,
): Promise<void> => {
  const fera = rows.filter(isFera);
  if (!fera.length) return;
  const ids = fera.map((r) => r.pk_id);
  const partners: { twin_id: number; category_name: string; status: string }[] = await query(
    `SELECT t.pk_id AS twin_id, pc.category_name, p.status::text AS status
       FROM emission t
       JOIN emission p ON (p.pk_id = t.fera_linked_id OR p.fera_linked_id = t.pk_id)
                      AND p.pk_id <> t.pk_id AND p.site_id = t.site_id
       JOIN category pc ON pc.category_id = p.category_id AND LOWER(pc.category_name) <> 'fera'
      WHERE t.pk_id = ANY($1)
      ORDER BY (p.pk_id = t.fera_linked_id) DESC, p.pk_id`,
    [ids],
  );
  const byTwin = new Map<number, { category_name: string; status: string }>();
  for (const p of partners) if (!byTwin.has(p.twin_id)) byTwin.set(p.twin_id, p);
  for (const row of fera) {
    const partner = byTwin.get(row.pk_id);
    Object.assign(row, {
      parent_category_name: partner?.category_name ?? null,
      fera_partner_status: partner?.status ?? null,
    });
  }
};
