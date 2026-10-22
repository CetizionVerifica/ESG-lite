// The quantity of each listed entry, for the "Quantity" column of My entries and
// the approvals ledger. Same rule as the Breakdown panel (emissionBreakdown.ts):
// a canonical key, then the number fields of the entry's own site × category
// forms in form order ("Amount of gas", "Fuel consumption" …), then a spend
// amount. A Category 3 (FERA) twin repeats its parent's fields, so it reads
// the parent category's forms.
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { ColumnConfig } from "../entities/ColumnConfig";
import { quantityOf } from "./emissionBreakdown";

export interface QuantityRow {
  pk_id: number;
  activity_data: Record<string, unknown> | null;
  site?: { site_id: number } | null;
  category?: { category_id: number; category_name?: string | null } | null;
  quantity?: number | null;
}

type Query = (sql: string, params: unknown[]) => Promise<any[]>;

const pairKey = (siteId: number, categoryId: number) => `${siteId}|${categoryId}`;
const isFera = (row: QuantityRow) => (row.category?.category_name ?? "").trim().toLowerCase() === "fera";

/** Sets `quantity` on every row (null when the entry has none). */
export async function addEntryQuantities(rows: QuantityRow[], query: Query = (sql, params) => AppDataSource.query(sql, params)): Promise<void> {
  if (!rows.length) return;

  // A FERA twin's parent category, found the way enrichFeraRows finds the partner.
  const fera = rows.filter(isFera);
  const parentCategory = new Map<number, number>();
  if (fera.length) {
    const partners: { twin_id: number; category_id: number }[] = await query(
      `SELECT t.pk_id AS twin_id, p.category_id
         FROM emission t
         JOIN emission p ON (p.pk_id = t.fera_linked_id OR p.fera_linked_id = t.pk_id)
                        AND p.pk_id <> t.pk_id AND p.site_id = t.site_id
         JOIN category pc ON pc.category_id = p.category_id AND LOWER(pc.category_name) <> 'fera'
        WHERE t.pk_id = ANY($1)
        ORDER BY (p.pk_id = t.fera_linked_id) DESC, p.pk_id`,
      [fera.map((r) => r.pk_id)],
    );
    for (const p of partners) if (!parentCategory.has(Number(p.twin_id))) parentCategory.set(Number(p.twin_id), Number(p.category_id));
  }

  const formOf = (row: QuantityRow): [number, number] | null => {
    const siteId = row.site?.site_id;
    const categoryId = parentCategory.get(row.pk_id) ?? row.category?.category_id;
    return siteId && categoryId ? [siteId, categoryId] : null;
  };

  const siteIds = [...new Set(rows.map(formOf).filter((f): f is [number, number] => f !== null).map(([s]) => s))];
  const categoryIds = [...new Set(rows.map(formOf).filter((f): f is [number, number] => f !== null).map(([, c]) => c))];
  const numberColumns = new Map<string, string[]>();
  if (siteIds.length && categoryIds.length) {
    // Same config order as getCalculationSpec and the Breakdown panel, so the fallback column order is stable.
    const configs = await AppDataSource.getRepository(ColumnConfig).find({
      where: { site: { site_id: In(siteIds) }, category: { category_id: In(categoryIds) } },
      relations: ["site", "category", "columns"],
      order: { config_name: "ASC" },
    });
    for (const cfg of configs) {
      if (!cfg.site || !cfg.category) continue;
      const key = pairKey(cfg.site.site_id, cfg.category.category_id);
      const names = numberColumns.get(key) ?? [];
      const columns = [...(cfg.columns ?? [])].sort((a, b) => a.pk_id - b.pk_id);
      for (const col of columns) if (col.column_type === "number" && !names.includes(col.column_name)) names.push(col.column_name);
      numberColumns.set(key, names);
    }
  }

  for (const row of rows) {
    const form = formOf(row);
    row.quantity = quantityOf(row.activity_data ?? {}, form ? (numberColumns.get(pairKey(...form)) ?? []) : []);
  }
}
