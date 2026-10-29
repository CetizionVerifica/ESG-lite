/**
 * S3-6 · Suppliers: the list, a supplier's figures and facility data, the
 * name-match review list, the C06 link and the coverage read model.
 *
 * Every query is filtered by the caller's company (layer rule 2): a supplier,
 * factor or document id of another company reads as "not found". Changes to
 * suppliers and their figures write `audit_log` rows (layer rule 6). Logs
 * carry ids only, never names or figures (rule 7).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { AuditLog } from "../../entities/AuditLog";
import { BoundaryError } from "../boundary/errors";
import { Scope3Error } from "../contracts/errors";
import { DEFAULT_GWP_SET } from "../contracts/factor";
import { similarPairs, looksSame, pairKey } from "./nameMatch";
import { FACTOR_EVIDENCE_SQL } from "./engineInput";
import { SUPPORTED_CURRENCIES, supportedCurrency } from "../spend/currencies";
import {
  CreateSupplierFactorSchema,
  CreateSupplierSchema,
  EXPECTED_BOUNDARY,
  FacilityDataSchema,
  NameMatchDecisionSchema,
  UpdateSupplierSchema,
} from "./schemas";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
  const r = schema.safeParse(body ?? {});
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new BoundaryError("SCOPE3_VALIDATION", { field: issue?.path.join(".") || null, message: issue?.message });
};

const audit = async (
  m: EntityManager,
  entityType: `scope3_${string}`,
  entityId: number,
  action: string,
  changed: Record<string, { old: unknown; new: unknown }>,
  userId: number,
  reason: string | null = null,
) => {
  await m.getRepository(AuditLog).save(
    m.getRepository(AuditLog).create({
      entity_type: entityType,
      entity_id: entityId,
      action,
      changed_fields: changed,
      reason,
      changed_by: userId ? ({ user_id: userId } as any) : (null as any),
    }),
  );
};

/** A unique violation (the case-folded name index). */
const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

/** The supplier, if it is this company's; otherwise 404, the same as an id that doesn't exist. */
const ownSupplier = async (m: EntityManager, companyId: number, supplierId: number) => {
  if (!Number.isInteger(supplierId) || supplierId <= 0) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const [row] = await m.query(`SELECT supplier_id, name, country, email FROM "supplier" WHERE supplier_id = $1 AND company_id = $2`, [supplierId, companyId]);
  if (!row) throw new BoundaryError("SCOPE3_NOT_FOUND");
  return row as SupplierRow;
};

export interface SupplierRow {
  supplier_id: number;
  name: string;
  country: string | null;
  email: string | null;
}

/** A year as a date window: CY Jan-Dec, FY Apr (y-1) to Mar y (src/services/reportingPeriod.ts). */
export const periodOf = (year: number, yearType: "CY" | "FY" = "CY") =>
  yearType === "FY" ? { from: `${year - 1}-04-01`, to: `${year}-03-31` } : { from: `${year}-01-01`, to: `${year}-12-31` };

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

/** GET /suppliers: the list with this year's rows and tCO₂e, whether a figure exists, and the last request. */
export const listSuppliers = async (companyId: number, opts: { year: number; yearType: "CY" | "FY" }) => {
  const { from, to } = periodOf(opts.year, opts.yearType);
  const rows = await AppDataSource.query(
    `SELECT s.supplier_id, s.name, s.country, s.email,
            coalesce(e.rows, 0)::int AS rows,
            coalesce(e.kg, 0)::float8 AS kg,
            coalesce(f.count, 0)::int AS factor_count,
            coalesce(fd.count, 0)::int AS facility_count,
            lr.supplier_request_id AS last_request_id, lr.status AS last_request_status,
            lr.sent_at AS last_request_sent_at, lr.material AS last_request_material
       FROM "supplier" s
       LEFT JOIN LATERAL (
            SELECT count(*) AS rows, sum(coalesce(em.total_kgco2e, em.total_emission * 1000)) AS kg
              FROM emission em
             WHERE em.supplier_id = s.supplier_id AND em.status <> 'rejected'
               AND em.date_of_reporting BETWEEN $2 AND $3) e ON true
       LEFT JOIN LATERAL (SELECT count(*) AS count FROM supplier_factor sf WHERE sf.supplier_id = s.supplier_id AND sf.company_id = $1) f ON true
       LEFT JOIN LATERAL (SELECT count(*) AS count FROM supplier_facility_data d WHERE d.supplier_id = s.supplier_id AND d.company_id = $1) fd ON true
       LEFT JOIN LATERAL (
            SELECT sr.supplier_request_id, sr.status, sr.sent_at, sr.material
              FROM supplier_request sr
             WHERE sr.company_id = $1
               AND (lower(btrim(sr.supplier_name)) = lower(s.name)
                    OR (s.email IS NOT NULL AND lower(sr.supplier_email) = lower(s.email)))
             ORDER BY sr.supplier_request_id DESC LIMIT 1) lr ON true
      WHERE s.company_id = $1
      ORDER BY lower(s.name)`,
    [companyId, from, to],
  );
  return {
    company_id: companyId,
    year: opts.year,
    year_type: opts.yearType,
    suppliers: rows.map((r: any) => ({
      supplier_id: r.supplier_id,
      name: r.name,
      country: r.country,
      email: r.email,
      rows_this_year: r.rows,
      tco2e: Math.round(Number(r.kg)) / 1000, // #209: 3 dp
      has_factor: r.factor_count > 0,
      factor_count: r.factor_count,
      has_facility_data: r.facility_count > 0,
      last_request: r.last_request_id
        ? { supplier_request_id: r.last_request_id, status: r.last_request_status, sent_at: r.last_request_sent_at, material: r.last_request_material }
        : null,
    })),
  };
};

/** GET /suppliers/:id: the supplier with its figures, facility data and requests (the detail drawer). */
export const getSupplier = async (companyId: number, supplierId: number) => {
  const supplier = await ownSupplier(AppDataSource.manager, companyId, supplierId);
  const [factors, facility, requests] = await Promise.all([
    listFactors(companyId, supplierId),
    listFacilityData(companyId, supplierId),
    AppDataSource.query(
      `SELECT supplier_request_id, status, material, unit, sent_at, received_at, decided_at
         FROM supplier_request
        WHERE company_id = $1
          AND (lower(btrim(supplier_name)) = lower($2) OR ($3::text IS NOT NULL AND lower(supplier_email) = lower($3)))
        ORDER BY supplier_request_id DESC LIMIT 20`,
      [companyId, supplier.name, supplier.email],
    ),
  ]);
  return { supplier, factors: factors.factors, facility_data: facility.facility_data, requests };
};

export const createSupplier = async (companyId: number, userId: number, body: unknown) => {
  const b = parse(CreateSupplierSchema, body);
  return AppDataSource.transaction(async (m) => {
    const exists = async () =>
      (await m.query(`SELECT supplier_id FROM "supplier" WHERE company_id = $1 AND lower(name) = lower($2)`, [companyId, b.name]))[0] as { supplier_id: number } | undefined;
    const duplicate = (supplier_id: number | null) =>
      new BoundaryError("SCOPE3_VALIDATION", { field: "name", message: "A supplier with this name already exists.", supplier_id });
    // Checked first so the answer is the same with or without the case-folded
    // unique index; the index (migrate:scope3-suppliers) closes the race.
    const before = await exists();
    if (before) throw duplicate(before.supplier_id);
    const [row] = await m.query(
      `INSERT INTO "supplier" (company_id, name, country, email, created_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING RETURNING supplier_id, name, country, email`,
      [companyId, b.name, b.country ?? null, b.email ?? null, userId || null],
    );
    if (!row) throw duplicate((await exists())?.supplier_id ?? null);
    await audit(m, "scope3_supplier", row.supplier_id, "create", { name: { old: null, new: row.name }, country: { old: null, new: row.country } }, userId);
    return row as SupplierRow;
  });
};

export const updateSupplier = async (companyId: number, userId: number, supplierId: number, body: unknown) => {
  const b = parse(UpdateSupplierSchema, body);
  return AppDataSource.transaction(async (m) => {
    const before = await ownSupplier(m, companyId, supplierId);
    const next = { name: b.name ?? before.name, country: b.country === undefined ? before.country : b.country, email: b.email === undefined ? before.email : b.email };
    if (b.name !== undefined) {
      const [clash] = await m.query(`SELECT supplier_id FROM "supplier" WHERE company_id = $1 AND lower(name) = lower($2) AND supplier_id <> $3`, [companyId, b.name, supplierId]);
      if (clash) throw new BoundaryError("SCOPE3_VALIDATION", { field: "name", message: "A supplier with this name already exists.", supplier_id: clash.supplier_id });
    }
    try {
      await m.query(`UPDATE "supplier" SET name = $1, country = $2, email = $3 WHERE supplier_id = $4 AND company_id = $5`, [next.name, next.country, next.email, supplierId, companyId]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BoundaryError("SCOPE3_VALIDATION", { field: "name", message: "A supplier with this name already exists." });
      throw err;
    }
    const changed: Record<string, { old: unknown; new: unknown }> = {};
    for (const k of ["name", "country", "email"] as const) if (before[k] !== next[k]) changed[k] = { old: before[k], new: next[k] };
    if (Object.keys(changed).length) await audit(m, "scope3_supplier", supplierId, "update", changed, userId);
    return { supplier_id: supplierId, ...next };
  });
};

// ---------------------------------------------------------------------------
// Figures (supplier_factor) and facility data
// ---------------------------------------------------------------------------

// `id` is the §4 contract's name for the key; `supplier_factor_id` is the column's.
const factorJson = (r: any) => ({
  id: r.supplier_factor_id,
  supplier_factor_id: r.supplier_factor_id,
  supplier_id: r.supplier_id,
  item: r.item,
  unit: r.unit,
  kgco2e_per_unit: Number(r.kgco2e_per_unit),
  boundary: r.boundary,
  reference_year: r.reference_year,
  gwp_set: r.gwp_set,
  source: r.source,
  evidence_document_id: r.evidence_document_id,
  material_factor_id: r.material_factor_id,
  supplier_request_id: r.supplier_request_id ?? null,
  has_evidence: !!r.has_evidence,
});

/** GET /suppliers/:id/factors, newest year first. */
export const listFactors = async (companyId: number, supplierId: number) => {
  await ownSupplier(AppDataSource.manager, companyId, supplierId);
  const rows = await AppDataSource.query(
    `SELECT sf.*, ${FACTOR_EVIDENCE_SQL} AS has_evidence,
            (SELECT sr.supplier_request_id FROM supplier_request sr
              WHERE sr.material_factor_id = sf.material_factor_id AND sf.material_factor_id IS NOT NULL AND sr.company_id = sf.company_id
              ORDER BY sr.supplier_request_id DESC LIMIT 1) AS supplier_request_id
       FROM supplier_factor sf
      WHERE sf.supplier_id = $1 AND sf.company_id = $2
      ORDER BY sf.reference_year DESC, sf.supplier_factor_id DESC`,
    [supplierId, companyId],
  );
  return { supplier_id: supplierId, factors: rows.map(factorJson) };
};

/**
 * POST /suppliers/:id/factors: a figure entered by hand. A boundary other
 * than cradle-to-gate is refused with SUPPLIER_FACTOR_BOUNDARY unless the
 * caller confirms it, the same pattern as the C06 accept.
 */
export const createFactor = async (companyId: number, userId: number, supplierId: number, body: unknown) => {
  const b = parse(CreateSupplierFactorSchema, body);
  if (b.boundary !== EXPECTED_BOUNDARY && b.confirm_boundary !== true) {
    throw new Scope3Error("SUPPLIER_FACTOR_BOUNDARY", { boundary: b.boundary, expected: EXPECTED_BOUNDARY, confirm_with: "confirm_boundary" });
  }
  return AppDataSource.transaction(async (m) => {
    await ownSupplier(m, companyId, supplierId);
    if (b.evidence_document_id) {
      const [doc] = await m.query(
        `SELECT 1 FROM emission_document d JOIN emission e ON e.pk_id = d.emission_id JOIN site s ON s.site_id = e.site_id
          WHERE d.document_id = $1 AND s.company_id = $2`,
        [b.evidence_document_id, companyId],
      );
      if (!doc) throw new BoundaryError("SCOPE3_VALIDATION", { field: "evidence_document_id", message: "That document wasn't found." });
    }
    const [row] = await m.query(
      `INSERT INTO supplier_factor (company_id, supplier_id, item, unit, kgco2e_per_unit, boundary, reference_year, gwp_set, evidence_document_id, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual') RETURNING *`,
      [companyId, supplierId, b.item, b.unit, String(b.kgco2e_per_unit), b.boundary, b.reference_year, b.gwp_set ?? DEFAULT_GWP_SET, b.evidence_document_id ?? null],
    );
    await audit(
      m,
      "scope3_supplier_factor",
      row.supplier_factor_id,
      "create",
      {
        supplier_id: { old: null, new: supplierId },
        kgco2e_per_unit: { old: null, new: b.kgco2e_per_unit },
        reference_year: { old: null, new: b.reference_year },
        ...(b.boundary !== EXPECTED_BOUNDARY ? { boundary: { old: EXPECTED_BOUNDARY, new: b.boundary } } : {}),
      },
      userId,
      b.boundary !== EXPECTED_BOUNDARY ? "Boundary confirmed by the user" : null,
    );
    return factorJson({ ...row, has_evidence: !!row.evidence_document_id });
  });
};

const facilityJson = (r: any) => ({
  id: r.supplier_facility_data_id,
  supplier_facility_data_id: r.supplier_facility_data_id,
  supplier_id: r.supplier_id,
  year: r.year,
  scope12_tco2e: Number(r.scope12_tco2e),
  output_qty: Number(r.output_qty),
  output_unit: r.output_unit,
  allocation_key: r.allocation_key,
});

export const listFacilityData = async (companyId: number, supplierId: number) => {
  await ownSupplier(AppDataSource.manager, companyId, supplierId);
  const rows = await AppDataSource.query(
    `SELECT * FROM supplier_facility_data WHERE supplier_id = $1 AND company_id = $2 ORDER BY year DESC, supplier_facility_data_id DESC`,
    [supplierId, companyId],
  );
  return { supplier_id: supplierId, facility_data: rows.map(facilityJson) };
};

/**
 * POST /suppliers/:id/facility-data: the facility's Scope 1+2 and output for
 * a year, for the hybrid method. One row per supplier and year: sending a
 * year again replaces its figures (the old ones stay in the audit log).
 */
export const upsertFacilityData = async (companyId: number, userId: number, supplierId: number, body: unknown) => {
  const b = parse(FacilityDataSchema, body);
  // Allocating by economic value compares what was paid with the facility's
  // output value, so that output must be an amount in a currency ESGLite knows.
  if (b.allocation_key === "economic") {
    const currency = supportedCurrency(b.output_unit);
    if (!currency) {
      throw new BoundaryError("SCOPE3_VALIDATION", {
        field: "output_unit",
        message: `To allocate by economic value, give the facility's output in a currency (${SUPPORTED_CURRENCIES.join(", ")}).`,
      });
    }
    b.output_unit = currency;
  }
  return AppDataSource.transaction(async (m) => {
    await ownSupplier(m, companyId, supplierId);
    const [existing] = await m.query(
      `SELECT * FROM supplier_facility_data WHERE supplier_id = $1 AND company_id = $2 AND year = $3 ORDER BY supplier_facility_data_id DESC LIMIT 1 FOR UPDATE`,
      [supplierId, companyId, b.year],
    );
    let row: any;
    if (existing) {
      [row] = await m.query(
        `UPDATE supplier_facility_data SET scope12_tco2e = $1, output_qty = $2, output_unit = $3, allocation_key = $4
          WHERE supplier_facility_data_id = $5 AND company_id = $6 RETURNING *`,
        [String(b.scope12_tco2e), String(b.output_qty), b.output_unit, b.allocation_key, existing.supplier_facility_data_id, companyId],
      );
      row = Array.isArray(row) ? row[0] : row;
    } else {
      [row] = await m.query(
        `INSERT INTO supplier_facility_data (company_id, supplier_id, year, scope12_tco2e, output_qty, output_unit, allocation_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [companyId, supplierId, b.year, String(b.scope12_tco2e), String(b.output_qty), b.output_unit, b.allocation_key],
      );
    }
    const old = existing ? facilityJson(existing) : null;
    const now = facilityJson(row);
    await audit(
      m,
      "scope3_supplier_facility",
      now.supplier_facility_data_id,
      existing ? "update" : "create",
      Object.fromEntries((["scope12_tco2e", "output_qty", "output_unit", "allocation_key"] as const).map((k) => [k, { old: old?.[k] ?? null, new: now[k] }])),
      userId,
    );
    return { ...now, replaced: !!existing };
  });
};

// ---------------------------------------------------------------------------
// Name-match review list
// ---------------------------------------------------------------------------

const NOT_SAME = "not_same";

/** Pairs a person has said are different firms (audit_log, entity_type scope3_supplier_match). */
const dismissedPairs = async (companyId: number): Promise<Set<string>> => {
  const rows = await AppDataSource.query(
    `SELECT a.changed_fields->'pair'->'new' AS pair
       FROM audit_log a
      WHERE a.entity_type = 'scope3_supplier_match' AND a.action = $1
        AND EXISTS (SELECT 1 FROM "supplier" s WHERE s.supplier_id = a.entity_id AND s.company_id = $2)`,
    [NOT_SAME, companyId],
  );
  const out = new Set<string>();
  for (const r of rows) if (Array.isArray(r.pair) && r.pair.length === 2) out.add(pairKey(Number(r.pair[0]), Number(r.pair[1])));
  return out;
};

/**
 * GET /suppliers/name-matches: what a person should look at.
 *   - `similar_suppliers`: two suppliers whose names look like one firm
 *     ("Gulf Smelter Co." and "Gulf Smelter Company"). Link merges them.
 *   - `unlinked_name`: rows naming a supplier in `extra_data.supplier_name`
 *     with no supplier linked, and the supplier that name looks like.
 */
export const nameMatches = async (companyId: number) => {
  const suppliers: Array<SupplierRow & { rows: number }> = await AppDataSource.query(
    `SELECT s.supplier_id, s.name, s.country, s.email, (SELECT count(*) FROM emission e WHERE e.supplier_id = s.supplier_id)::int AS rows
       FROM "supplier" s WHERE s.company_id = $1 ORDER BY s.supplier_id`,
    [companyId],
  );
  const dismissed = await dismissedPairs(companyId);
  const similar = similarPairs(suppliers, dismissed).map(([a, b]) => ({ type: "similar_suppliers" as const, a, b }));

  const unlinked: Array<{ name: string; rows: number }> = await AppDataSource.query(
    `SELECT btrim(e.extra_data->>'supplier_name') AS name, count(*)::int AS rows
       FROM emission e JOIN site si ON si.site_id = e.site_id
      WHERE si.company_id = $1 AND e.supplier_id IS NULL AND coalesce(btrim(e.extra_data->>'supplier_name'), '') <> ''
      GROUP BY btrim(e.extra_data->>'supplier_name')
      ORDER BY count(*) DESC LIMIT 200`,
    [companyId],
  );
  const names = unlinked.map((u) => {
    const exact = suppliers.find((s) => s.name.toLowerCase() === u.name.toLowerCase()) ?? null;
    const candidate = exact ?? suppliers.find((s) => looksSame(s.name, u.name)) ?? null;
    return { type: "unlinked_name" as const, name: u.name, rows: u.rows, candidate, exact: !!exact };
  });
  return { company_id: companyId, matches: [...similar, ...names] };
};

/**
 * POST /suppliers/name-matches: a person's decision on one match.
 *   - similar suppliers, link: `other_id` is merged into `keep_id` (its rows,
 *     figures and facility data move; the email and country fill gaps), and
 *     the other row is removed once nothing points at it.
 *   - similar suppliers, not the same: remembered, so the pair isn't shown again.
 *   - unlinked name, link: those rows get `supplier_id`.
 *   - unlinked name, not the same: a supplier of its own is created for the name.
 */
export const decideNameMatch = async (companyId: number, userId: number, body: unknown) => {
  const b = parse(NameMatchDecisionSchema, body);
  return AppDataSource.transaction(async (m) => {
    if (b.type === "similar_suppliers") {
      if (b.keep_id === b.other_id) throw new BoundaryError("SCOPE3_VALIDATION", { field: "other_id", message: "Choose two different suppliers." });
      const keep = await ownSupplier(m, companyId, b.keep_id);
      const other = await ownSupplier(m, companyId, b.other_id);
      if (b.decision === "not_same") {
        await audit(m, "scope3_supplier_match", keep.supplier_id, NOT_SAME, { pair: { old: null, new: [keep.supplier_id, other.supplier_id] } }, userId, "Not the same supplier");
        return { decision: b.decision, keep_id: keep.supplier_id, other_id: other.supplier_id };
      }
      const [, rowsMoved] = await m.query(`UPDATE emission SET supplier_id = $1 WHERE supplier_id = $2`, [keep.supplier_id, other.supplier_id]);
      const [, factorsMoved] = await m.query(`UPDATE supplier_factor SET supplier_id = $1 WHERE supplier_id = $2 AND company_id = $3`, [keep.supplier_id, other.supplier_id, companyId]);
      const [, facilityMoved] = await m.query(`UPDATE supplier_facility_data SET supplier_id = $1 WHERE supplier_id = $2 AND company_id = $3`, [keep.supplier_id, other.supplier_id, companyId]);
      await m.query(`UPDATE "supplier" SET email = coalesce(email, $1), country = coalesce(country, $2) WHERE supplier_id = $3 AND company_id = $4`, [other.email, other.country, keep.supplier_id, companyId]);
      // Everything the other spelling had now points at the kept supplier,
      // and the audit row below keeps its name, email and country.
      await m.query(`DELETE FROM "supplier" WHERE supplier_id = $1 AND company_id = $2`, [other.supplier_id, companyId]);
      await audit(
        m,
        "scope3_supplier",
        keep.supplier_id,
        "merge",
        {
          merged_supplier: { old: other, new: null },
          emission_rows: { old: other.supplier_id, new: keep.supplier_id },
        },
        userId,
        `Linked as the same supplier (${rowsMoved} rows, ${factorsMoved} figures, ${facilityMoved} facility years moved)`,
      );
      return { decision: b.decision, keep_id: keep.supplier_id, other_id: other.supplier_id, rows_moved: rowsMoved, factors_moved: factorsMoved, facility_moved: facilityMoved };
    }

    // An unlinked name.
    const nameFilter = `e.supplier_id IS NULL AND lower(btrim(e.extra_data->>'supplier_name')) = lower($2)
      AND e.site_id IN (SELECT site_id FROM site WHERE company_id = $1)`;
    let target: SupplierRow;
    if (b.decision === "link") {
      if (!b.supplier_id) throw new BoundaryError("SCOPE3_VALIDATION", { field: "supplier_id", message: "Choose the supplier to link to." });
      target = await ownSupplier(m, companyId, b.supplier_id);
    } else {
      const [same] = await m.query(`SELECT 1 FROM "supplier" WHERE company_id = $1 AND lower(name) = lower($2)`, [companyId, b.name]);
      const [created] = same
        ? []
        : await m.query(
            `INSERT INTO "supplier" (company_id, name, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING supplier_id, name, country, email`,
            [companyId, b.name, userId || null],
          );
      if (!created) throw new BoundaryError("SCOPE3_VALIDATION", { field: "name", message: "A supplier with exactly this name exists already; link the rows to it." });
      await audit(m, "scope3_supplier", created.supplier_id, "create", { name: { old: null, new: created.name } }, userId, "Not the same as the suggested supplier");
      target = created;
    }
    const [, linked] = await m.query(`UPDATE emission e SET supplier_id = $3 WHERE ${nameFilter}`, [companyId, b.name, target.supplier_id]);
    await audit(m, "scope3_supplier", target.supplier_id, "link_rows", { emission_rows: { old: null, new: linked } }, userId, "Rows linked by name");
    return { decision: b.decision, supplier_id: target.supplier_id, rows_linked: linked };
  });
};

// ---------------------------------------------------------------------------
// C06 link (D8)
// ---------------------------------------------------------------------------

export interface C06AcceptLink {
  companyId: number;
  userId: number;
  supplierName: string | null;
  supplierEmail: string | null;
  item: string;
  unit: string;
  kgco2eperUnit: number;
  boundary: string;
  referenceYear: number;
  gwpSet: string;
  materialFactorId: number;
}

/**
 * On a C06 accept, inside the accept's transaction: link the request to the
 * company's supplier (by case-folded name, then by email) or create it, and
 * write the accepted figure as a `supplier_factor` (source supplier_request,
 * `material_factor_id` set). The evidence is the file the supplier sent with
 * its answer, reached through the request (`FACTOR_EVIDENCE_SQL`). PCF's own
 * MaterialFactor is untouched.
 */
export const linkC06Accept = async (m: EntityManager, a: C06AcceptLink): Promise<{ supplier_id: number; supplier_factor_id: number; created_supplier: boolean }> => {
  const name = (a.supplierName ?? "").trim() || (a.supplierEmail ?? "").split("@")[1] || "Supplier";
  let [supplier] = await m.query(`SELECT supplier_id, email FROM "supplier" WHERE company_id = $1 AND lower(name) = lower($2)`, [a.companyId, name]);
  if (!supplier && a.supplierEmail) {
    [supplier] = await m.query(`SELECT supplier_id, email FROM "supplier" WHERE company_id = $1 AND lower(email) = lower($2) ORDER BY supplier_id LIMIT 1`, [a.companyId, a.supplierEmail]);
  }
  let created = false;
  if (!supplier) {
    [supplier] = await m.query(
      `INSERT INTO "supplier" (company_id, name, email, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING supplier_id, email`,
      [a.companyId, name, a.supplierEmail, a.userId || null],
    );
    if (!supplier) [supplier] = await m.query(`SELECT supplier_id, email FROM "supplier" WHERE company_id = $1 AND lower(name) = lower($2)`, [a.companyId, name]);
    created = true;
    await audit(m, "scope3_supplier", supplier.supplier_id, "create", { name: { old: null, new: name } }, a.userId, "Created from an accepted supplier request");
  } else if (!supplier.email && a.supplierEmail) {
    await m.query(`UPDATE "supplier" SET email = $1 WHERE supplier_id = $2 AND company_id = $3`, [a.supplierEmail, supplier.supplier_id, a.companyId]);
  }
  const [factor] = await m.query(
    `INSERT INTO supplier_factor (company_id, supplier_id, item, unit, kgco2e_per_unit, boundary, reference_year, gwp_set, source, material_factor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'supplier_request', $9) RETURNING supplier_factor_id`,
    [a.companyId, supplier.supplier_id, a.item, a.unit, String(a.kgco2eperUnit), a.boundary, a.referenceYear, a.gwpSet, a.materialFactorId],
  );
  await audit(
    m,
    "scope3_supplier_factor",
    factor.supplier_factor_id,
    "create",
    { supplier_id: { old: null, new: supplier.supplier_id }, kgco2e_per_unit: { old: null, new: a.kgco2eperUnit }, material_factor_id: { old: null, new: a.materialFactorId } },
    a.userId,
    "Accepted supplier request",
  );
  return { supplier_id: supplier.supplier_id, supplier_factor_id: factor.supplier_factor_id, created_supplier: created };
};

// ---------------------------------------------------------------------------
// Coverage read model (S3-13)
// ---------------------------------------------------------------------------

export interface SupplierCoverage {
  from: string;
  to: string;
  /** All Category 1 and 2 rows in the period. */
  cat12_tco2e: number;
  /** Of those, the rows calculated with a supplier's own figure. */
  supplier_specific_tco2e: number;
  /** … and by the hybrid method. */
  hybrid_tco2e: number;
  /** (supplier-specific + hybrid) / all Cat 1 and 2, in %. Null when there is nothing in Cat 1 or 2. */
  coverage_pct: number | null;
  /** The 20 suppliers with the most Cat 1 and 2 tCO₂e, whatever the method. */
  top_suppliers: Array<{ supplier_id: number; name: string; tco2e: number; rows: number; supplier_data_tco2e: number }>;
}

/**
 * `suppliers.coverage(company, period)` (spec §Build.6): the share of
 * Category 1 and 2 tCO₂e from supplier data, and the top 20 suppliers.
 * Sums kgCO₂e and rounds once (D5). Approved rows only by default, as
 * reports count them; pass `statuses` to widen.
 */
export const coverage = async (
  companyId: number,
  period: { from: string; to: string },
  opts: { statuses?: string[]; siteIds?: number[] } = {},
  manager: EntityManager = AppDataSource.manager,
): Promise<SupplierCoverage> => {
  const statuses = opts.statuses?.length ? opts.statuses : ["approved"];
  const params: unknown[] = [companyId, period.from, period.to, statuses];
  const siteFilter = opts.siteIds?.length ? `AND e.site_id = ANY($${params.push(opts.siteIds)}::int[])` : "";
  const base = `FROM emission e
       JOIN site si ON si.site_id = e.site_id
       JOIN category c ON c.category_id = e.category_id
      WHERE si.company_id = $1 AND c.ghg_category IN (1, 2)
        AND e.date_of_reporting BETWEEN $2 AND $3
        AND e.status::text = ANY($4::text[]) ${siteFilter}`;
  const kg = `coalesce(e.total_kgco2e, e.total_emission * 1000)`;
  const [totals] = await manager.query(
    `SELECT coalesce(sum(${kg}), 0)::float8 AS all_kg,
            coalesce(sum(${kg}) FILTER (WHERE e.method = 'supplier_specific'), 0)::float8 AS supplier_kg,
            coalesce(sum(${kg}) FILTER (WHERE e.method = 'hybrid'), 0)::float8 AS hybrid_kg
       ${base}`,
    params,
  );
  const top = await manager.query(
    `SELECT s.supplier_id, s.name, sum(${kg})::float8 AS kg, count(*)::int AS rows,
            coalesce(sum(${kg}) FILTER (WHERE e.method IN ('supplier_specific', 'hybrid')), 0)::float8 AS supplier_kg
       ${base.replace("JOIN category c", `JOIN "supplier" s ON s.supplier_id = e.supplier_id AND s.company_id = $1\n       JOIN category c`)}
      GROUP BY s.supplier_id, s.name
      ORDER BY sum(${kg}) DESC, s.supplier_id
      LIMIT 20`,
    params,
  );
  const t = (kgValue: number) => Math.round(Number(kgValue)) / 1000; // #209: kg → tCO₂e at 3 dp
  const all = Number(totals.all_kg);
  const covered = Number(totals.supplier_kg) + Number(totals.hybrid_kg);
  return {
    from: period.from,
    to: period.to,
    cat12_tco2e: t(all),
    supplier_specific_tco2e: t(totals.supplier_kg),
    hybrid_tco2e: t(totals.hybrid_kg),
    coverage_pct: all > 0 ? Math.round((covered / all) * 1000) / 10 : null,
    top_suppliers: top.map((r: any) => ({ supplier_id: r.supplier_id, name: r.name, tco2e: t(r.kg), rows: r.rows, supplier_data_tco2e: t(r.supplier_kg) })),
  };
};
