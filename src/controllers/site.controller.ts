import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { grantCategoriesToSiteUsers } from "../utils/siteCategorySync";
import type { EntityManager } from "typeorm";
import { removeDeletedDocumentFiles } from "./document.controller";

const siteRepo = AppDataSource.getRepository(Site);
const categoryRepo = AppDataSource.getRepository(Category);

export const createSite = async (req: Request, res: Response) => {
  try {
    const { name, address, contact_person, company_id, country_id, category_ids } = req.body;

    // 1️⃣ Validate input
    if (!name || !address || !contact_person || !company_id || !country_id) {
      return res.status(400).json({
        message: "All fields (name, address, contact_person, company_id, country_id) are required",
      });
    }

    // 2️⃣ Fetch categories if provided
    let categories: Category[] = [];
    if (category_ids && Array.isArray(category_ids) && category_ids.length > 0) {
      categories = await categoryRepo.findByIds(category_ids);
      if (categories.length !== category_ids.length) {
        return res.status(400).json({
          message: "One or more categories not found",
        });
      }
    }

    // 3️⃣ Create site
    const site = siteRepo.create({
      name: name.trim(),
      address: address.trim(),
      contact_person: contact_person.trim(),
      company: { company_id },
      country: { country_id },
      categories, // Associate categories
    });

    await siteRepo.save(site);

    // 4️⃣ Respond
    return res.status(201).json({
      message: "Site created successfully",
      site,
    });
  } catch (error) {
    console.error("Create site error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getSites = async (_: Request, res: Response) => {
  try {
    const sites = await siteRepo.find({
      relations: ["company", "country", "categories"], // Added categories
      order: { name: "ASC" },
    });
    return res.status(200).json(sites);
  } catch (error) {
    console.error("Fetch sites error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getSiteById = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const site = await siteRepo.findOne({
      where: { site_id: parseInt(id) },
      relations: ["company", "country", "categories"],
    });

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    return res.status(200).json(site);
  } catch (error) {
    console.error("Fetch site by ID error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const updateSite = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { name, address, contact_person, company_id, country_id, category_ids } = req.body;

    // 1️⃣ Validate input
    if (!name && !address && !contact_person && !company_id && !country_id && !category_ids) {
      return res.status(400).json({
        message: "At least one field is required for update",
      });
    }

    // 2️⃣ Check if site exists
    const site = await siteRepo.findOne({
      where: { site_id: parseInt(id) },
      relations: ["company", "country", "categories"], // Added categories
    });

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    // 3️⃣ Update basic fields
    if (name) site.name = name.trim();
    if (address) site.address = address.trim();
    if (contact_person) site.contact_person = contact_person.trim();
    if (company_id) site.company = { company_id } as any;
    if (country_id) site.country = { country_id } as any;

    // 4️⃣ Update categories if provided
    let newlyAddedCategories: Category[] = [];
    if (category_ids && Array.isArray(category_ids)) {
      const categories = await categoryRepo.findByIds(category_ids);
      if (categories.length !== category_ids.length) {
        return res.status(400).json({
          message: "One or more categories not found",
        });
      }
      // Categories present in the new set but not previously on the site.
      const oldCategoryIds = new Set((site.categories || []).map((c) => c.category_id));
      newlyAddedCategories = categories.filter((c) => !oldCategoryIds.has(c.category_id));
      site.categories = categories;
    }

    await siteRepo.save(site);

    // Make newly assigned categories visible to existing users on this site,
    // otherwise login filtering hides them from the data-entry tab.
    await grantCategoriesToSiteUsers(parseInt(id), newlyAddedCategories);

    return res.status(200).json({
      message: "Site updated successfully",
      site,
    });
  } catch (error) {
    console.error("Update site error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Tables that hold rows for a site without a foreign key to it: cleared with the site so nothing
// is left pointing at a site that no longer exists. Each is skipped when it isn't there.
const SITE_ROWS_WITHOUT_FK = [
  "emission_category_mapping",
  "final_emission",
  "import_plan_match",
  "insight_event",
  "kpi_assignment",
  "kpi_period_lock",
  "kpi_target",
  "kpi_topic_assignment",
  "kpi_value",
  "nothing_this_month",
  "period_lock",
];

const columnPresent = async (m: EntityManager, table: string, column: string): Promise<boolean> => {
  const rows = await m.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`, [table, column]);
  return rows.length > 0;
};

// UPDATE / DELETE … RETURNING answers [rows, affected] through TypeORM's Postgres driver.
const returned = <T>(result: unknown): T[] =>
  Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number" ? (result[0] as T[]) : ((result as T[]) ?? []);

const tablePresent = async (m: EntityManager, table: string): Promise<boolean> => {
  const [{ present }] = await m.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [table]);
  return Boolean(present);
};

/**
 * DELETE /admin/sites/:id (Superadmin; the screen asks for the site's name first). Deletes the
 * site and what is recorded for it, as the confirm lists: entries and their evidence, factors,
 * forms, units, products, production data, PCF studies, bills, KPI values, locks and the site's
 * mappings. Two links had no cascade, so deleting a site with people or bills always failed (500):
 * people assigned through user_sites and the AI service's bills (invoice, also linked from
 * entries). People keep their accounts: someone whose main site this is moves to another of their
 * sites, or has no site until the Superadmin assigns one (a user row cascaded from the site would
 * have taken their account, and failed once they had done anything). One transaction; stored
 * files go after the commit, by the same rule as deleting entries.
 */
export const deleteSite = async (req: Request, res: Response) => {
  try {
    const siteId = Number(req.params.id);
    if (!Number.isInteger(siteId) || siteId <= 0) {
      return res.status(400).json({ message: "Invalid site id" });
    }

    const site = await siteRepo.findOne({ where: { site_id: siteId } });
    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    const summary = await AppDataSource.transaction(async (m) => {
      const [{ entries }] = await m.query(`SELECT COUNT(*)::int AS entries FROM emission WHERE site_id = $1`, [siteId]);
      // Evidence files of the site's entries, and its bills' files (removed once the bill is gone).
      const files: Array<{ cloudinary_public_id: string; ai_invoice_id: number | null }> = await m.query(
        `SELECT d.cloudinary_public_id, d.ai_invoice_id
           FROM emission_document d JOIN emission e ON e.pk_id = d.emission_id
          WHERE e.site_id = $1 AND d.cloudinary_public_id IS NOT NULL`,
        [siteId],
      );
      let bills = 0;
      if (await tablePresent(m, "invoice")) {
        files.push(
          ...(await m.query(`SELECT cloudinary_public_id, invoice_id AS ai_invoice_id FROM invoice WHERE site_id = $1 AND cloudinary_public_id IS NOT NULL`, [siteId])),
        );
        // A bill of another site linked to one of these entries only loses the link.
        if (await columnPresent(m, "invoice", "emission_id")) await m.query(`UPDATE invoice SET emission_id = NULL WHERE emission_id IN (SELECT pk_id FROM emission WHERE site_id = $1)`, [siteId]);
        bills = returned(await m.query(`DELETE FROM invoice WHERE site_id = $1 RETURNING invoice_id`, [siteId])).length;
      }

      // People keep their accounts: their main site becomes another of theirs, else none.
      const moved = returned<{ user_id: number; site_id: number | null }>(await m.query(
        `UPDATE "user" u
            SET site_id = (SELECT MIN(us.site_id) FROM user_sites us WHERE us.user_id = u.user_id AND us.site_id <> $1)
          WHERE u.site_id = $1
      RETURNING u.user_id, u.site_id`,
        [siteId],
      ));
      const assigned = returned<{ user_id: number }>(await m.query(`DELETE FROM user_sites WHERE site_id = $1 RETURNING user_id`, [siteId]));
      const people = new Set([...moved, ...assigned].map((r) => Number(r.user_id)));
      const withoutSite = moved.filter((r) => r.site_id === null).length;

      for (const table of SITE_ROWS_WITHOUT_FK) {
        if (await tablePresent(m, table)) await m.query(`DELETE FROM ${table} WHERE site_id = $1`, [siteId]);
      }

      // Entries (and their documents), factors, forms, units, products, production data, PCF studies,
      // site categories and import profiles go with the site (onDelete: CASCADE).
      await m.getRepository(Site).delete({ site_id: siteId });
      return { entries: Number(entries), bills, people: people.size, people_without_site: withoutSite, files };
    });

    await removeDeletedDocumentFiles(summary.files);

    return res.status(200).json({
      message: "Site deleted successfully",
      deleted: { entries: summary.entries, bills: summary.bills },
      people_kept: summary.people,
      people_without_site: summary.people_without_site,
    });
  } catch (error) {
    console.error("Delete site error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

