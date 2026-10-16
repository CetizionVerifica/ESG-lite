/**
 * S3-10 · the material split of a product for Category 12, read from its
 * latest PCF study (read-only on `pcf_*`; S3-10 never changes a study).
 *
 *   - A1 lines (the bill of materials) split the product's own mass;
 *   - A3_packaging lines split its packaging;
 *   - only lines in a mass unit count (kg, g, t), by their quantity per
 *     declared unit; each line is sorted into one of the form's materials
 *     (configs.ts MATERIALS) by its material factor's group and its name;
 *   - no study, or no line in a mass unit → one "Mixed" line.
 *
 * "Latest" = a published or approved study first, then the newest reference
 * period and version; superseded versions never count.
 */
import { AppDataSource } from "../../config/data-source";
import type { Queryable } from "../taxonomy/service";
import { MATERIALS, type Material } from "./configs";

export interface BomLine {
  stage: string;
  name: string;
  material_group: string | null;
  quantity: number;
  unit: string;
}

/** Material → share of the mass (0–1), shares summing to 1. */
export type MaterialSplit = Partial<Record<Material, number>>;

export interface ProductBom {
  product: MaterialSplit;
  packaging: MaterialSplit;
  /** The study the split came from, or null when there is none (then both splits are Mixed). */
  pcf_study_id: number | null;
}

const MASS_TO_KG: Record<string, number> = { kg: 1, kgs: 1, g: 0.001, t: 1000, tonne: 1000, tonnes: 1000, ton: 1000, tons: 1000, mt: 1000 };

/** kg for a quantity in a mass unit, else null. */
export const massKg = (quantity: number, unit: string): number | null => {
  const k = MASS_TO_KG[String(unit ?? "").trim().toLowerCase()];
  return k === undefined || !Number.isFinite(quantity) ? null : quantity * k;
};

const BY_GROUP: Record<string, Material> = { aluminium: "Aluminium", copper: "Copper", steel: "Steel", polymer: "Plastics" };
const BY_NAME: Array<[RegExp, Material]> = [
  [/alumin/i, "Aluminium"],
  [/copper/i, "Copper"],
  [/steel|iron/i, "Steel"],
  [/paper|card ?board|carton|corrugated/i, "Paper and board"],
  [/wood|timber|pallet|drum|reel/i, "Wood"],
  [/glass/i, "Glass"],
  [/textile|fabric|cotton|yarn/i, "Textiles"],
  [/plastic|polymer|poly|pvc|xlpe|hdpe|ldpe|\bpe\b|\bpp\b|\bpet\b|nylon|rubber|film|foil wrap/i, "Plastics"],
];

/** The form material a BOM line belongs to; anything unrecognised is "Mixed". */
export function materialOf(line: Pick<BomLine, "name" | "material_group">): Material {
  const group = BY_GROUP[String(line.material_group ?? "").toLowerCase()];
  if (group) return group;
  for (const [re, m] of BY_NAME) if (re.test(line.name ?? "")) return m;
  return "Mixed";
}

/** Shares by mass of the lines in a mass unit; Mixed 100 % when none has one. */
export function splitByMass(lines: Array<Pick<BomLine, "name" | "material_group" | "quantity" | "unit">>): MaterialSplit {
  const kg: MaterialSplit = {};
  let total = 0;
  for (const l of lines) {
    const k = massKg(Number(l.quantity), l.unit);
    if (k === null || k <= 0) continue;
    const m = materialOf(l);
    kg[m] = (kg[m] ?? 0) + k;
    total += k;
  }
  if (total <= 0) return { Mixed: 1 };
  const out: MaterialSplit = {};
  // In MATERIALS order, so rows come out in a stable order.
  for (const m of MATERIALS) if (kg[m]) out[m] = kg[m]! / total;
  return out;
}

export function bomFromLines(lines: BomLine[], pcf_study_id: number | null): ProductBom {
  return {
    product: splitByMass(lines.filter((l) => l.stage === "A1")),
    packaging: splitByMass(lines.filter((l) => l.stage === "A3_packaging")),
    pcf_study_id,
  };
}

/** The split per product id, for the products of one company. */
export async function bomsFor(companyId: number, productIds: number[], q: Queryable = AppDataSource): Promise<Map<number, ProductBom>> {
  const out = new Map<number, ProductBom>();
  if (!productIds.length) return out;
  const studies: Array<{ product_id: number; pcf_study_id: number }> = await q.query(
    `SELECT DISTINCT ON (s.product_id) s.product_id, s.pcf_study_id
       FROM pcf_study s
      WHERE s.company_id = $1 AND s.product_id = ANY($2::int[]) AND s.status <> 'superseded'
      ORDER BY s.product_id, (s.status IN ('published', 'approved')) DESC, s.reference_end DESC, s.version DESC, s.pcf_study_id DESC`,
    [companyId, productIds],
  );
  const studyIds = studies.map((s) => Number(s.pcf_study_id));
  const lines: Array<BomLine & { pcf_study_id: number }> = studyIds.length
    ? await q.query(
        `SELECT i.pcf_study_id, i.stage, i.name, mf.material_group, i.quantity, i.unit
           FROM pcf_input i LEFT JOIN material_factor mf ON mf.material_factor_id = i.material_factor_id
          WHERE i.pcf_study_id = ANY($1::int[]) AND i.stage IN ('A1', 'A3_packaging')
          ORDER BY i.pcf_study_id, i.sort_order, i.pcf_input_id`,
        [studyIds],
      )
    : [];
  for (const id of productIds) {
    const study = studies.find((s) => Number(s.product_id) === id);
    const mine = study ? lines.filter((l) => Number(l.pcf_study_id) === Number(study.pcf_study_id)) : [];
    out.set(id, bomFromLines(mine.map((l) => ({ ...l, quantity: Number(l.quantity) })), study ? Number(study.pcf_study_id) : null));
  }
  return out;
}
