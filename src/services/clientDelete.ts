import { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { deleteFromR2, r2Enabled } from "../config/r2";
import { UserRole } from "../types/type";

/**
 * Deleting a client (Superadmin, Danger zone).
 *
 * Only a client without reporting history can be deleted: deleting a site
 * cascades its emissions, production and PCF rows in the database, so the
 * check runs first and a client with any history gets a 409 with the counts
 * (deactivate it instead). Without history the delete removes the client's
 * setup: its sites (with their categories, column configs, factors, units and
 * products), the people who belong only to this client, its category
 * mappings, threshold, brand row and stored brand files.
 *
 * The check and the delete run in one transaction that first locks the
 * company and site rows (FOR UPDATE). Saving an entry, production record or
 * PCF study checks its foreign key with a lock that conflicts with that, so
 * nothing can be added between the check and the delete. Superadmins are
 * never deleted with a client, even if their only site links are here.
 */

export type ClientHistory = {
  entries: number;
  production: number;
  pcfStudies: number;
  /** Bills read by the AI service (its `invoice` table, when it shares this database). */
  invoices: number;
  documents: number;
  auditEntries: number;
};

export type ClientDeleteResult =
  | { status: "not_found" }
  | { status: "has_history"; history: ClientHistory }
  /** Something else still points at the client's people or sites (a foreign key refused the delete). */
  | { status: "blocked" }
  | { status: "deleted"; removed: { sites: number; people: number; mappings: number; brand: boolean } };

// TypeORM's raw query gives [rows, affected] for DELETE ... RETURNING.
const deletedRows = <T>(raw: unknown): T[] => (Array.isArray(raw) && Array.isArray(raw[0]) ? (raw[0] as T[]) : (raw as T[]));

const count = async (m: EntityManager, sql: string, params: unknown[]): Promise<number> =>
  Number((await m.query(sql, params))[0]?.n ?? 0);

/** People linked to any of these sites, with whether all their sites are among them. */
const linkedPeople = async (
  m: EntityManager,
  siteIds: number[],
): Promise<{ userId: number; onlyHere: boolean; superadmin: boolean }[]> => {
  if (!siteIds.length) return [];
  const rows: { user_id: number; only_here: boolean; role: string }[] = await m.query(
    `WITH links AS (
       SELECT user_id, site_id FROM "user" WHERE site_id IS NOT NULL
       UNION
       SELECT user_id, site_id FROM user_sites
     )
     SELECT l.user_id, bool_and(l.site_id = ANY($1)) AS only_here, u.role
       FROM links l JOIN "user" u ON u.user_id = l.user_id
      WHERE l.user_id IN (SELECT user_id FROM links WHERE site_id = ANY($1))
      GROUP BY l.user_id, u.role`,
    [siteIds],
  );
  return rows.map((r) => ({ userId: Number(r.user_id), onlyHere: r.only_here, superadmin: r.role === UserRole.SUPERADMIN }));
};

export const clientHistory = async (
  m: EntityManager,
  companyId: number,
  siteIds: number[],
  userIds: number[],
): Promise<ClientHistory> => {
  const hasInvoiceTable = !!(await m.query(`SELECT to_regclass('public.invoice') AS t`))[0]?.t;
  return {
    entries: siteIds.length ? await count(m, `SELECT count(*) AS n FROM emission WHERE site_id = ANY($1)`, [siteIds]) : 0,
    production: siteIds.length ? await count(m, `SELECT count(*) AS n FROM production_data WHERE site_id = ANY($1)`, [siteIds]) : 0,
    pcfStudies: await count(m, `SELECT count(*) AS n FROM pcf_study WHERE company_id = $1 OR site_id = ANY($2)`, [companyId, siteIds]),
    // The AI service's table has no foreign keys here, so its rows would be
    // left pointing at deleted sites and people.
    invoices: hasInvoiceTable
      ? await count(m, `SELECT count(*) AS n FROM invoice WHERE site_id = ANY($1) OR uploaded_by = ANY($2)`, [siteIds, userIds])
      : 0,
    // Files and change history left by this client's people outlive the entries
    // they were about; deleting the people would orphan (or be blocked by) them.
    documents: userIds.length ? await count(m, `SELECT count(*) AS n FROM emission_document WHERE uploaded_by = ANY($1)`, [userIds]) : 0,
    auditEntries: userIds.length ? await count(m, `SELECT count(*) AS n FROM audit_log WHERE changed_by = ANY($1)`, [userIds]) : 0,
  };
};

export const hasHistory = (h: ClientHistory): boolean => Object.values(h).some((n) => n > 0);

/** "12 entries, 3 production records" for the refusal message. */
export const describeHistory = (h: ClientHistory): string => {
  const parts: [number, string, string][] = [
    [h.entries, "entry", "entries"],
    [h.production, "production record", "production records"],
    [h.pcfStudies, "PCF study", "PCF studies"],
    [h.invoices, "uploaded bill", "uploaded bills"],
    [h.documents, "uploaded document", "uploaded documents"],
    [h.auditEntries, "change-history record", "change-history records"],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(", ");
};

const FOREIGN_KEY_VIOLATION = "23503";

export const deleteClient = async (companyId: number): Promise<ClientDeleteResult> => {
  const brandKeys: string[] = [];
  let result: ClientDeleteResult;
  try {
    result = await AppDataSource.transaction(async (m): Promise<ClientDeleteResult> => {
      const company = await m.query(`SELECT company_id FROM company WHERE company_id = $1 FOR UPDATE`, [companyId]);
      if (!company.length) return { status: "not_found" };
      const siteIds: number[] = (
        await m.query(`SELECT site_id FROM site WHERE company_id = $1 ORDER BY site_id FOR UPDATE`, [companyId])
      ).map((r: { site_id: number }) => Number(r.site_id));
      const people = await linkedPeople(m, siteIds);
      const leaving = people.filter((p) => p.onlyHere && !p.superadmin).map((p) => p.userId);

      const history = await clientHistory(m, companyId, siteIds, leaving);
      if (hasHistory(history)) return { status: "has_history", history };

      // People who also work for another client keep their account; only the
      // links to this client's sites go (with the sites below).
      if (siteIds.length) {
        await m.query(`DELETE FROM user_sites WHERE site_id = ANY($1)`, [siteIds]);
        // A kept person's own site_id would take their account down with the
        // site (ON DELETE CASCADE), so it moves to one of their remaining
        // sites, or is cleared when they have none.
        await m.query(
          `UPDATE "user" u
              SET site_id = (SELECT us.site_id FROM user_sites us WHERE us.user_id = u.user_id ORDER BY us.site_id LIMIT 1)
            WHERE u.site_id = ANY($1) AND NOT (u.user_id = ANY($2))`,
          [siteIds, leaving],
        );
      }
      if (leaving.length) await m.query(`DELETE FROM "user" WHERE user_id = ANY($1)`, [leaving]);
      const mappings = deletedRows<{ id: number }>(
        await m.query(`DELETE FROM emission_category_mapping WHERE company_id = $1 RETURNING id`, [companyId]),
      );
      if (siteIds.length) await m.query(`DELETE FROM site WHERE company_id = $1`, [companyId]);
      const brand = deletedRows<{ logo_public_id: string | null; logo_on_dark_public_id: string | null; guideline_public_id: string | null }>(
        await m.query(
          `DELETE FROM brand WHERE company_id = $1 RETURNING logo_public_id, logo_on_dark_public_id, guideline_public_id`,
          [companyId],
        ),
      );
      for (const b of brand) {
        for (const key of [b.logo_public_id, b.logo_on_dark_public_id, b.guideline_public_id]) if (key) brandKeys.push(key);
      }
      // Threshold and company material factors cascade from the company row.
      await m.query(`DELETE FROM company WHERE company_id = $1`, [companyId]);
      return {
        status: "deleted",
        removed: { sites: siteIds.length, people: leaving.length, mappings: mappings.length, brand: brand.length > 0 },
      };
    });
  } catch (error) {
    // The whole delete rolled back; nothing changed.
    if ((error as { code?: string })?.code === FOREIGN_KEY_VIOLATION) {
      console.error(`Delete of client ${companyId} refused by a foreign key:`, error);
      return { status: "blocked" };
    }
    throw error;
  }

  // Files go after the rows: a failed file delete leaves an unreferenced
  // object, never a row pointing at a missing file.
  if (result.status === "deleted" && r2Enabled()) {
    for (const key of brandKeys) {
      try {
        await deleteFromR2(key);
      } catch (error) {
        console.error(`Could not delete brand file ${key} of deleted client ${companyId}:`, error);
      }
    }
  }

  return result;
};
