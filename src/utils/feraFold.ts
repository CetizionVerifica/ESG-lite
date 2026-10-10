// The approvals list folds a pending FERA twin into its partner entry while
// that partner is pending too: one row, one decision (approving the parent
// approves its pending twin). A pending twin whose partner is not pending
// (approved, rejected or gone) has no row to fold into and needs its own
// review, so it counts on its own.
//
// SQL condition for "this row is a pending FERA twin folded into a pending
// partner". `e` is the emission alias, `c` its category alias.
export const foldedFeraTwinSql = (e: string, c: string): string =>
  `(${e}.status = 'pending' AND LOWER(${c}.category_name) = 'fera' AND EXISTS (
     SELECT 1 FROM emission fp
      WHERE (fp.pk_id = ${e}.fera_linked_id OR fp.fera_linked_id = ${e}.pk_id)
        AND fp.pk_id <> ${e}.pk_id AND fp.status = 'pending'))`;

// Entries waiting for review as the approvals list shows them.
export const pendingReviewCountSql = (e: string, c: string): string =>
  `COUNT(*) FILTER (WHERE ${e}.status = 'pending' AND NOT ${foldedFeraTwinSql(e, c)})`;
