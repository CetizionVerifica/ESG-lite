/**
 * Category taxonomy (S3-1): which GHG Protocol number each Scope 3 category
 * carries, the proposals for the ones that have none yet, and the read model
 * reports use (S3-13).
 *
 * `category` is global (no company link); a company "uses" a category when it
 * is on one of the company's sites (site_categories). Proposals are per
 * company × category, the confirmed number lives on category.ghg_category.
 */
import { AppDataSource } from "../../config/data-source";
import { GHG_CATEGORIES, GhgCategoryNumber, isGhgCategoryNumber } from "../contracts/ghgCategory";
import { proposeGhgCategory } from "./propose";

/** Anything with TypeORM's `query` (DataSource, EntityManager, QueryRunner). */
export interface Queryable {
  query: (sql: string, params?: any[]) => Promise<any>;
}

/** SQL test for a Scope 3 category, tolerant of older spellings ("scope3", "S3"). */
export const isScope3Sql = (alias: string) =>
  `regexp_replace(lower(coalesce(${alias}.scope, '')), '[^a-z0-9]', '', 'g') IN ('scope3', 's3')`;

export const isScope3 = (scope: unknown): boolean =>
  typeof scope === "string" && ["scope3", "s3"].includes(scope.toLowerCase().replace(/[^a-z0-9]/g, ""));

export interface CompanyCategory {
  category_id: number;
  category_name: string;
  ghg_category: number | null;
}

/** The Scope 3 categories on a company's sites. */
export async function companyScope3Categories(companyId: number, q: Queryable = AppDataSource): Promise<CompanyCategory[]> {
  const rows: any[] = await q.query(
    `SELECT DISTINCT c.category_id, c.category_name, c.ghg_category
       FROM category c
       JOIN site_categories sc ON sc.category_id = c.category_id
       JOIN site s ON s.site_id = sc.site_id
      WHERE s.company_id = $1 AND ${isScope3Sql("c")}
      ORDER BY c.category_name`,
    [companyId],
  );
  return rows.map((r) => ({
    category_id: Number(r.category_id),
    category_name: r.category_name,
    ghg_category: r.ghg_category === null ? null : Number(r.ghg_category),
  }));
}

/**
 * Writes a proposal for every Scope 3 category of the company that has no
 * number and no proposal yet. An exact name match (confidence 100) is also
 * written to category.ghg_category and recorded as confirmed by the system;
 * nothing else touches category.ghg_category. Safe to re-run: existing
 * proposals are never duplicated or changed.
 */
export async function refreshProposals(companyId: number, q: Queryable = AppDataSource): Promise<{ proposed: number; applied: number }> {
  const categories = await companyScope3Categories(companyId, q);
  let proposed = 0;
  let applied = 0;
  for (const c of categories) {
    if (c.ghg_category !== null) continue;
    const p = proposeGhgCategory(c.category_name);
    const exact = p.basis === "exact" && p.confidence === 100 && p.ghg_category !== null;
    const inserted: any[] = await q.query(
      `INSERT INTO category_ghg_map_proposal (category_id, company_id, ghg_category, confidence, basis, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, ${exact ? "now()" : "NULL"})
       ON CONFLICT (company_id, category_id) DO NOTHING
       RETURNING id`,
      [c.category_id, companyId, p.ghg_category, p.confidence, p.basis],
    );
    if (inserted.length) proposed++;
    if (exact) {
      const updated: any[] = await q.query(
        `UPDATE category SET ghg_category = $1 WHERE category_id = $2 AND ghg_category IS NULL RETURNING category_id`,
        [p.ghg_category, c.category_id],
      );
      if (updated.length) applied++;
    }
  }
  return { proposed, applied };
}

/** D10: Cats 13–15 start as Not relevant for current clients, to confirm. */
export const D10_REASON = "No leased-out assets, franchises or investments";
const D10_DEFAULT_NOT_RELEVANT = new Set<number>([13, 14, 15]);

/**
 * Seeds the company's 15 boundary rows when missing (never changes an
 * existing row): `included` for numbers the company already uses (a confirmed
 * number, or a proposal of 90 % or more), `not_relevant` for 13–15 (D10),
 * `screening` for the rest.
 */
export async function ensureBoundaryRows(companyId: number, q: Queryable = AppDataSource): Promise<number> {
  const inUse: any[] = await q.query(
    `SELECT DISTINCT c.ghg_category AS n
       FROM category c
       JOIN site_categories sc ON sc.category_id = c.category_id
       JOIN site s ON s.site_id = sc.site_id
      WHERE s.company_id = $1 AND c.ghg_category IS NOT NULL AND ${isScope3Sql("c")}
     UNION
     SELECT p.ghg_category AS n
       FROM category_ghg_map_proposal p
       JOIN category c ON c.category_id = p.category_id
      WHERE p.company_id = $1 AND p.ghg_category IS NOT NULL AND p.confidence >= 90
        AND c.ghg_category IS NULL AND ${isScope3Sql("c")}`,
    [companyId],
  );
  const used = new Set(inUse.map((r) => Number(r.n)));
  const values: any[] = [];
  const tuples: string[] = [];
  for (const c of GHG_CATEGORIES) {
    const status = used.has(c.n) ? "included" : D10_DEFAULT_NOT_RELEVANT.has(c.n) ? "not_relevant" : "screening";
    const reason = status === "not_relevant" ? D10_REASON : null;
    const i = values.length;
    tuples.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4})`);
    values.push(companyId, c.n, status, reason);
  }
  const inserted: any[] = await q.query(
    `INSERT INTO company_scope3_category (company_id, ghg_category, status, reason)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (company_id, ghg_category) DO NOTHING
     RETURNING id`,
    values,
  );
  return inserted.length;
}

/**
 * The confirmed GHG number of a category, or null when it is Unmapped or not
 * a Scope 3 category. The read model for reports (S3-13).
 */
export async function categoryNumberFor(categoryId: number, q: Queryable = AppDataSource): Promise<GhgCategoryNumber | null> {
  const rows: any[] = await q.query(
    `SELECT c.ghg_category FROM category c WHERE c.category_id = $1 AND ${isScope3Sql("c")}`,
    [categoryId],
  );
  const n = rows.length ? Number(rows[0].ghg_category) : null;
  return n !== null && isGhgCategoryNumber(n) ? n : null;
}

/**
 * The map counts as confirmed once at least one proposal was confirmed and no
 * Scope 3 category with a proposal is still waiting for its number. From then
 * on a new Scope 3 category must come with a number (GHG_CATEGORY_REQUIRED).
 */
export async function isMapConfirmed(q: Queryable = AppDataSource): Promise<boolean> {
  const [row]: any[] = await q.query(
    `SELECT EXISTS (SELECT 1 FROM category_ghg_map_proposal WHERE confirmed_at IS NOT NULL) AS any_confirmed,
            EXISTS (SELECT 1 FROM category_ghg_map_proposal p JOIN category c ON c.category_id = p.category_id
                     WHERE p.confirmed_at IS NULL AND c.ghg_category IS NULL AND ${isScope3Sql("c")}) AS any_open`,
  );
  return Boolean(row?.any_confirmed) && !row?.any_open;
}
