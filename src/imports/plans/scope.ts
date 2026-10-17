import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { accessibleSiteIds, resolveUserCompanyId } from "../../utils/companyScope";
import { WriterContext } from "../writer";
import { ImportError } from "../errors";

export type TokenUser = { userId: number; role: string };

/**
 * The WriterContext for a request: which client the call is about and which
 * sites and categories the caller may write to.
 *
 *  - Superadmin: must name the client (`company_id`, IMPORT_COMPANY_REQUIRED);
 *    every site of that client, every category assigned to each site.
 *  - Admin: every site of their own client. A `company_id` that is not their
 *    own is refused (IMPORT_FORBIDDEN), never silently swapped.
 *  - Manager: their sites (user_sites).
 *  - User: their site(s); when they hold category grants (user_categories),
 *    only those categories, as in the app.
 */
export const buildWriterContext = async (user: TokenUser, companyIdParam?: number): Promise<WriterContext> => {
  const userId = Number(user.userId);
  let companyId: number;
  let siteIds: number[];

  if (user.role === UserRole.SUPERADMIN) {
    if (!companyIdParam) throw new ImportError("IMPORT_COMPANY_REQUIRED");
    const company = await AppDataSource.query(`SELECT company_id FROM company WHERE company_id = $1`, [companyIdParam]);
    if (!company.length) throw new ImportError("IMPORT_FORBIDDEN");
    companyId = companyIdParam;
    const sites: { site_id: number }[] = await AppDataSource.query(`SELECT site_id FROM site WHERE company_id = $1`, [companyId]);
    siteIds = sites.map((s) => Number(s.site_id));
  } else {
    const own = await resolveUserCompanyId(userId);
    if (!own) throw new ImportError("IMPORT_FORBIDDEN");
    if (companyIdParam && companyIdParam !== own) throw new ImportError("IMPORT_FORBIDDEN");
    companyId = own;
    const allowed = await accessibleSiteIds(userId, user.role);
    siteIds = allowed ? [...allowed] : [];
  }

  const byCategory: Record<number, number[]> = {};
  if (siteIds.length) {
    const rows: { site_id: number; category_id: number }[] = await AppDataSource.query(
      `SELECT site_id, category_id FROM site_categories WHERE site_id = ANY($1::int[])`,
      [siteIds],
    );
    let grants: Set<number> | null = null;
    if (user.role === UserRole.USER) {
      const g: { category_id: number }[] = await AppDataSource.query(`SELECT category_id FROM user_categories WHERE user_id = $1`, [userId]);
      if (g.length) grants = new Set(g.map((r) => Number(r.category_id)));
    }
    for (const id of siteIds) byCategory[id] = [];
    for (const r of rows) {
      const cat = Number(r.category_id);
      if (grants && !grants.has(cat)) continue;
      byCategory[Number(r.site_id)].push(cat);
    }
  }

  return { user_id: userId, role: user.role, company_id: companyId, allowed_site_ids: siteIds, allowed_category_ids_by_site: byCategory };
};

let mcpColumnKnown: boolean | null = null;

/**
 * `company.mcp_enabled` is IM5's column. Until that migration has run the
 * switch reads as off, which is the documented default (00-plan §2.6).
 */
export const isMcpEnabled = async (companyId: number): Promise<boolean> => {
  if (mcpColumnKnown === null) {
    const col = await AppDataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'company' AND column_name = 'mcp_enabled'`,
    );
    mcpColumnKnown = col.length > 0;
  }
  if (!mcpColumnKnown) return false;
  const rows: { mcp_enabled: boolean }[] = await AppDataSource.query(`SELECT mcp_enabled FROM company WHERE company_id = $1`, [companyId]);
  return rows.length > 0 && rows[0].mcp_enabled === true;
};

let aiImportColumnKnown: boolean | null = null;

/**
 * `company.ai_import_enabled` (smart Excel import, XI0, migrate:ai-import).
 * Reads as off until the migration has run, which is the documented default.
 */
export const isAiImportEnabled = async (companyId: number): Promise<boolean> => {
  if (aiImportColumnKnown === null) {
    const col = await AppDataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'company' AND column_name = 'ai_import_enabled'`,
    );
    aiImportColumnKnown = col.length > 0;
  }
  if (!aiImportColumnKnown) return false;
  const rows: { ai_import_enabled: boolean }[] = await AppDataSource.query(`SELECT ai_import_enabled FROM company WHERE company_id = $1`, [companyId]);
  return rows.length > 0 && rows[0].ai_import_enabled === true;
};
