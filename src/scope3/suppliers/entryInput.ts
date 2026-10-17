/**
 * S3-6 · The supplier fields a typed entry may carry (`POST /user/emissions`):
 * `supplier_id` and, for the supplier-specific method, `supplier_factor_id`.
 * Whether the supplier belongs to the site's company is checked by the engine
 * (`emissionWrite/index.ts`), so every channel refuses the same ones.
 */
export type SupplierRefParse =
  | { ok: true; value: { supplier_id?: number | null; supplier_factor_id?: number | null } }
  | { ok: false; field: string; message: string };

const idOf = (raw: unknown): number | null | undefined | typeof NaN => {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

export const parseSupplierRef = (body: unknown): SupplierRefParse => {
  const b = (body ?? {}) as Record<string, unknown>;
  const supplier_id = idOf(b.supplier_id);
  if (Number.isNaN(supplier_id)) return { ok: false, field: "supplier_id", message: "supplier_id must be a supplier's id." };
  const supplier_factor_id = idOf(b.supplier_factor_id);
  if (Number.isNaN(supplier_factor_id)) return { ok: false, field: "supplier_factor_id", message: "supplier_factor_id must be a supplier figure's id." };
  const value: { supplier_id?: number | null; supplier_factor_id?: number | null } = {};
  if (supplier_id !== undefined) value.supplier_id = supplier_id;
  if (supplier_factor_id !== undefined) value.supplier_factor_id = supplier_factor_id;
  return { ok: true, value };
};
