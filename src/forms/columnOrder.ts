/**
 * The order of a form's fields. column_config_columns (the form ↔ field join)
 * has no position, so a form read back its fields in whatever order the
 * database returned them and the builder's ↑/↓ never stuck. The order is kept
 * as column ids in column_config.column_order (migrate:form-field-order).
 *
 *   null order        → the fields as stored (forms saved before the column)
 *   ids not in order  → after the listed ones, in their stored order
 *   ids in order only → ignored (a field since removed)
 */

/** The fields sorted by `order`. */
export const orderColumns = <C extends { pk_id: number }>(columns: C[], order: number[] | null | undefined): C[] => {
  if (!order?.length) return columns;
  const rank = new Map(order.map((id, i) => [Number(id), i]));
  const at = (c: C) => rank.get(Number(c.pk_id)) ?? order.length;
  return columns.map((c, i) => ({ c, i })).sort((a, b) => at(a.c) - at(b.c) || a.i - b.i).map(({ c }) => c);
};

/** The order to store for the fields a save sends, in the order sent (duplicates dropped). */
export const orderFromIds = (ids: unknown[]): number[] => [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];

/** The order after fields are added at the end (the form's current fields first). */
export const orderWithAdded = <C extends { pk_id: number }>(current: C[], added: C[]): number[] =>
  orderFromIds([...current, ...added].map((c) => c.pk_id));

/** The order with one field swapped for another in its place (a rename that makes a new library field). */
export const orderWithSwap = (order: number[] | null | undefined, from: number, to: number): number[] | null =>
  order?.length ? orderFromIds(order.map((id) => (Number(id) === Number(from) ? to : id))) : (order ?? null);
