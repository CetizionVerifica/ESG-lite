/**
 * Scope 3 boundary (S3-1): the company's 15 category rows, the category map
 * (proposals and confirmations) and the consolidation approach. Every query
 * filters by the company id resolved in access.ts. Changes write audit_log
 * rows (entity_type scope3_*) with old and new values.
 */
import { AppDataSource } from "../../config/data-source";
import { GHG_CATEGORIES } from "../contracts/ghgCategory";
import { isGhgCategoryNumber } from "../taxonomy/number";
import { Scope3Error } from "../contracts/errors";
import { BoundaryError } from "./errors";
import { companyScope3Categories, ensureBoundaryRows, isScope3Sql, Queryable, refreshProposals } from "../taxonomy/service";
import { leaseNotes } from "../assets/service";

export const BOUNDARY_STATUSES = ["included", "excluded", "not_relevant", "screening"] as const;
export type BoundaryStatus = (typeof BOUNDARY_STATUSES)[number];

export const CONSOLIDATION_APPROACHES = ["operational_control", "financial_control", "equity_share"] as const;
export type ConsolidationApproach = (typeof CONSOLIDATION_APPROACHES)[number];

/** Table II relevance criteria (ticks in `relevance`): defined in the contracts, re-exported for older imports. */
import { RELEVANCE_KEYS } from "../contracts/schemas";
export { RELEVANCE_KEYS };

const MAX_TEXT = 2000;

async function audit(q: Queryable, entityType: string, entityId: number, action: string, changed: Record<string, { old: any; new: any }>, userId: number, reason: string | null) {
  if (!Object.keys(changed).length) return;
  await q.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [entityType, entityId, action, JSON.stringify(changed), reason, userId || null],
  );
}

export async function getBoundary(companyId: number) {
  await ensureBoundaryRows(companyId);
  const [company]: any[] = await AppDataSource.query(
    `SELECT company_id, name, consolidation_approach FROM company WHERE company_id = $1`,
    [companyId],
  );
  const rows: any[] = await AppDataSource.query(
    `SELECT b.ghg_category, b.status, b.reason, b.method_note, b.relevance, b.updated_at,
            b.updated_by, u.name AS updated_by_name
       FROM company_scope3_category b
       LEFT JOIN "user" u ON u.user_id = b.updated_by
      WHERE b.company_id = $1
      ORDER BY b.ghg_category`,
    [companyId],
  );
  const categories = await companyScope3Categories(companyId);
  const byN = new Map(rows.map((r) => [Number(r.ghg_category), r]));
  const summary = { included: 0, excluded: 0, not_relevant: 0, screening: 0 } as Record<BoundaryStatus, number>;

  const list = GHG_CATEGORIES.map((c) => {
    const r = byN.get(c.n);
    const status = (r?.status ?? "screening") as BoundaryStatus;
    summary[status] = (summary[status] ?? 0) + 1;
    return {
      n: c.n,
      key: c.key,
      name: c.name,
      direction: c.direction,
      methods: c.methods.map((m) => m.key),
      status,
      reason: r?.reason ?? null,
      method_note: r?.method_note ?? null,
      relevance: r?.relevance ?? null,
      updated_at: r?.updated_by ? r.updated_at : null,
      updated_by: r?.updated_by ? { user_id: Number(r.updated_by), name: r.updated_by_name ?? null } : null,
      mapped_categories: categories
        .filter((m) => m.ghg_category === c.n)
        .map((m) => ({ category_id: m.category_id, category_name: m.category_name })),
    };
  });

  return {
    company_id: companyId,
    consolidation_approach: company?.consolidation_approach ?? "operational_control",
    summary,
    unmapped_count: categories.filter((m) => m.ghg_category === null).length,
    categories: list,
    // S3-11: leased and franchised sites with where their energy belongs (never moves rows).
    lease_sites: await leaseNotes(companyId),
  };
}

export interface BoundaryUpdate {
  status?: unknown;
  reason?: unknown;
  method_note?: unknown;
  relevance?: unknown;
}

const textOrNull = (value: unknown, field: string): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > MAX_TEXT) throw new BoundaryError("SCOPE3_VALIDATION", { field });
  const t = value.trim();
  return t === "" ? null : t;
};

export async function updateBoundaryRow(companyId: number, n: number, body: BoundaryUpdate, userId: number) {
  if (!isGhgCategoryNumber(n)) throw new Scope3Error("GHG_CATEGORY_INVALID", { field: "n" });
  if (body.status !== undefined && !BOUNDARY_STATUSES.includes(body.status as BoundaryStatus)) {
    throw new BoundaryError("SCOPE3_VALIDATION", { field: "status", allowed: BOUNDARY_STATUSES });
  }
  const reason = textOrNull(body.reason, "reason");
  const methodNote = textOrNull(body.method_note, "method_note");
  let relevance: Record<string, boolean> | null | undefined;
  if (body.relevance !== undefined) {
    if (body.relevance === null) relevance = null;
    else if (typeof body.relevance !== "object" || Array.isArray(body.relevance)) {
      throw new BoundaryError("SCOPE3_VALIDATION", { field: "relevance" });
    } else {
      relevance = {};
      for (const [k, v] of Object.entries(body.relevance as Record<string, unknown>)) {
        if (!(RELEVANCE_KEYS as readonly string[]).includes(k) || typeof v !== "boolean") {
          throw new BoundaryError("SCOPE3_VALIDATION", { field: `relevance.${k}`, allowed: RELEVANCE_KEYS });
        }
        relevance[k] = v;
      }
    }
  }

  await ensureBoundaryRows(companyId);
  return AppDataSource.transaction(async (m) => {
    const [row]: any[] = await m.query(
      `SELECT id, status, reason, method_note, relevance FROM company_scope3_category
        WHERE company_id = $1 AND ghg_category = $2 FOR UPDATE`,
      [companyId, n],
    );
    const next = {
      status: (body.status as string | undefined) ?? row.status,
      reason: reason === undefined ? row.reason : reason,
      method_note: methodNote === undefined ? row.method_note : methodNote,
      relevance: relevance === undefined ? row.relevance : relevance,
    };
    if ((next.status === "excluded" || next.status === "not_relevant") && !next.reason) {
      throw new Scope3Error("EXCLUSION_REASON_REQUIRED", { n });
    }

    const changed: Record<string, { old: any; new: any }> = {};
    for (const k of ["status", "reason", "method_note", "relevance"] as const) {
      if (JSON.stringify(row[k] ?? null) !== JSON.stringify(next[k] ?? null)) changed[k] = { old: row[k] ?? null, new: next[k] ?? null };
    }
    await m.query(
      `UPDATE company_scope3_category
          SET status = $1, reason = $2, method_note = $3, relevance = $4, updated_by = $5, updated_at = now()
        WHERE id = $6`,
      [next.status, next.reason, next.method_note, next.relevance === null ? null : JSON.stringify(next.relevance), userId || null, row.id],
    );
    await audit(m, "scope3_boundary", Number(row.id), "update", { ghg_category: { old: n, new: n }, ...changed }, userId, next.reason ?? null);
    return { n, ...next };
  });
}

export async function getCategoryMap(companyId: number) {
  await refreshProposals(companyId);
  const rows: any[] = await AppDataSource.query(
    `SELECT c.category_id, c.category_name, c.ghg_category AS current,
            p.ghg_category AS proposed, p.confidence, p.basis, p.confirmed_at, p.confirmed_by
       FROM category c
       JOIN category_ghg_map_proposal p ON p.category_id = c.category_id AND p.company_id = $1
      WHERE ${isScope3Sql("c")}
        AND EXISTS (SELECT 1 FROM site_categories sc JOIN site s ON s.site_id = sc.site_id
                     WHERE sc.category_id = c.category_id AND s.company_id = $1)
      ORDER BY (c.ghg_category IS NULL) DESC, p.confidence DESC, c.category_name`,
    [companyId],
  );
  const proposals = rows.map((r) => ({
    category_id: Number(r.category_id),
    category_name: r.category_name,
    ghg_category: r.current === null ? null : Number(r.current),
    proposed: r.proposed === null ? null : Number(r.proposed),
    confidence: Number(r.confidence),
    basis: r.basis,
    confirmed: r.current !== null,
    confirmed_at: r.confirmed_at,
  }));
  return {
    company_id: companyId,
    unmapped: proposals.filter((p) => p.ghg_category === null),
    mapped: proposals.filter((p) => p.ghg_category !== null),
  };
}

export interface MapConfirmation {
  category_id: number;
  ghg_category: number;
}

/**
 * Confirms numbers for the company's Scope 3 categories: writes
 * category.ghg_category, marks the proposal confirmed and moves a boundary
 * row still in `screening` to `included`. A category that isn't one of the
 * company's Scope 3 categories gives 404 for the whole request.
 */
export async function confirmCategoryMap(companyId: number, confirm: unknown, userId: number) {
  if (!Array.isArray(confirm) || confirm.length === 0 || confirm.length > 500) {
    throw new BoundaryError("SCOPE3_VALIDATION", { field: "confirm" });
  }
  const items: MapConfirmation[] = confirm.map((c: any, i: number) => {
    const categoryId = Number(c?.category_id);
    const n = Number(c?.ghg_category);
    if (!Number.isInteger(categoryId) || categoryId <= 0) throw new BoundaryError("SCOPE3_VALIDATION", { field: `confirm[${i}].category_id` });
    if (!isGhgCategoryNumber(n)) throw new Scope3Error("GHG_CATEGORY_INVALID", { field: `confirm[${i}].ghg_category` });
    return { category_id: categoryId, ghg_category: n };
  });

  const own = new Map((await companyScope3Categories(companyId)).map((c) => [c.category_id, c]));
  const missing = items.filter((i) => !own.has(i.category_id)).map((i) => i.category_id);
  if (missing.length) throw new BoundaryError("SCOPE3_NOT_FOUND", { category_ids: missing });

  await ensureBoundaryRows(companyId);
  return AppDataSource.transaction(async (m) => {
    for (const item of items) {
      const before = own.get(item.category_id)!.ghg_category;
      await m.query(`UPDATE category SET ghg_category = $1 WHERE category_id = $2`, [item.ghg_category, item.category_id]);
      await m.query(
        `INSERT INTO category_ghg_map_proposal (category_id, company_id, ghg_category, confidence, basis, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, 100, 'confirmed', $4, now())
         ON CONFLICT (company_id, category_id)
         DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at`,
        [item.category_id, companyId, item.ghg_category, userId || null],
      );
      await m.query(
        `UPDATE company_scope3_category SET status = 'included', updated_by = $3, updated_at = now()
          WHERE company_id = $1 AND ghg_category = $2 AND status = 'screening'`,
        [companyId, item.ghg_category, userId || null],
      );
      await audit(m, "scope3_category_map", item.category_id, "confirm", { ghg_category: { old: before, new: item.ghg_category } }, userId, null);
    }
    return { confirmed: items };
  });
}

export async function setConsolidationApproach(companyId: number, value: unknown, userId: number) {
  if (typeof value !== "string" || !CONSOLIDATION_APPROACHES.includes(value as ConsolidationApproach)) {
    throw new BoundaryError("SCOPE3_VALIDATION", { field: "consolidation_approach", allowed: CONSOLIDATION_APPROACHES });
  }
  return AppDataSource.transaction(async (m) => {
    const [row]: any[] = await m.query(`SELECT consolidation_approach FROM company WHERE company_id = $1 FOR UPDATE`, [companyId]);
    if (!row) throw new BoundaryError("SCOPE3_NOT_FOUND");
    if (row.consolidation_approach !== value) {
      await m.query(`UPDATE company SET consolidation_approach = $1 WHERE company_id = $2`, [value, companyId]);
      await audit(m, "scope3_consolidation", companyId, "update", { consolidation_approach: { old: row.consolidation_approach, new: value } }, userId, null);
    }
    return { company_id: companyId, consolidation_approach: value };
  });
}
