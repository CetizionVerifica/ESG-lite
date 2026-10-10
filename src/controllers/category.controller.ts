import { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { Category } from "../entities/Category";
import { Site } from "../entities/Site";
import { grantCategoriesToSiteUsers } from "../utils/siteCategorySync";

const repo = AppDataSource.getRepository(Category);
const siteRepo = AppDataSource.getRepository(Site);

type CategoryUsage = { sites: number; entries: number; factors: number; configs: number; units: number };

// Per-category usage counts in one statement (correlated subqueries, no N+1).
// Units link to a category through unit.category_id (no inverse relation on
// Category), entries are emission rows.
const loadCategoryUsage = async (categoryIds?: number[]): Promise<Map<number, CategoryUsage>> => {
  const params: any[] = [];
  let where = "";
  if (categoryIds) {
    params.push(categoryIds);
    where = "WHERE c.category_id = ANY($1::int[])";
  }
  const rows: any[] = await AppDataSource.query(
    `SELECT c.category_id,
            (SELECT COUNT(*) FROM site_categories sc WHERE sc.category_id = c.category_id)::int AS sites,
            (SELECT COUNT(*) FROM emission e WHERE e.category_id = c.category_id)::int AS entries,
            (SELECT COUNT(*) FROM emission_factors f WHERE f.category_id = c.category_id)::int AS factors,
            (SELECT COUNT(*) FROM column_config cc WHERE cc.category_id = c.category_id)::int AS configs,
            (SELECT COUNT(*) FROM unit u WHERE u.category_id = c.category_id)::int AS units
       FROM category c ${where}`,
    params
  );
  return new Map(
    rows.map((r) => [
      Number(r.category_id),
      { sites: r.sites, entries: r.entries, factors: r.factors, configs: r.configs, units: r.units },
    ])
  );
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const { category_name, scope, site_ids, assign_all_sites } = req.body;

    // 1️⃣ Validate input
    if (!category_name) {
      return res.status(400).json({
        message: "Category name is required",
      });
    }

    // 2️⃣ Check for duplicates (case-insensitive)
    const existing = await repo.findOne({
      where: [{ category_name: category_name.trim() }],
    });

    if (existing) {
      return res.status(409).json({
        message: "Category already exists",
      });
    }

    // 3️⃣ Resolve which sites to assign this category to.
    let targetSiteIds: number[] = [];
    if (assign_all_sites) {
      const allSites = await siteRepo.find({ select: ["site_id"] });
      targetSiteIds = allSites.map((s) => s.site_id);
    } else if (Array.isArray(site_ids) && site_ids.length > 0) {
      const sites = await siteRepo.findBy({ site_id: In(site_ids) });
      if (sites.length !== site_ids.length) {
        return res.status(400).json({
          message: "One or more sites not found",
        });
      }
      targetSiteIds = sites.map((s) => s.site_id);
    }

    // 4️⃣ Create category
    const category = repo.create({
      category_name: category_name.trim(),
      scope: scope ? scope.trim() : null,
    });

    await repo.save(category);

    // 5️⃣ Assign to the selected sites and propagate to their users so the
    // category appears in the data-entry tab without a separate site edit.
    if (targetSiteIds.length > 0) {
      await repo
        .createQueryBuilder()
        .relation(Category, "sites")
        .of(category.category_id)
        .add(targetSiteIds);

      for (const siteId of targetSiteIds) {
        await grantCategoriesToSiteUsers(siteId, [category]);
      }
    }

    // 6️⃣ Respond
    return res.status(201).json({
      message: "Category created successfully",
      category,
      assigned_site_ids: targetSiteIds,
    });
  } catch (error) {
    console.error("Create category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await repo.find({
      relations: ["sites"],
      order: { category_name: "ASC" },
    });

    const usage = await loadCategoryUsage();
    const withCounts = categories.map((c) => {
      const u = usage.get(c.category_id);
      return {
        ...c,
        factor_count: u?.factors ?? 0,
        config_count: u?.configs ?? 0,
        unit_count: u?.units ?? 0,
        entry_count: u?.entries ?? 0,
      };
    });

    return res.status(200).json(withCounts);
  } catch (error) {
    console.error("Fetch categories error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const category = await repo.findOne({
      where: { category_id: parseInt(id) },
      relations: ["sites", "emission_factors"],
    });

    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    return res.status(200).json(category);
  } catch (error) {
    console.error("Fetch category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { category_name, scope, site_ids } = req.body;

    // 1️⃣ Validate input
    if (!category_name && !scope && site_ids === undefined) {
      return res.status(400).json({
        message: "At least one field (category_name, scope or site_ids) is required",
      });
    }

    let targetSiteIds: number[] | null = null;
    if (site_ids !== undefined) {
      if (
        !Array.isArray(site_ids) ||
        !site_ids.every((v: unknown) => Number.isInteger(Number(v)) && v !== null && v !== "")
      ) {
        return res.status(400).json({
          message: "site_ids must be an array of site ids",
        });
      }
      targetSiteIds = [...new Set(site_ids.map((v: unknown) => Number(v)))];
    }

    // 2️⃣ Check if category exists
    const category = await repo.findOne({
      where: { category_id: parseInt(id) },
      relations: ["sites"],
    });

    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    // 3️⃣ Check for duplicates (exclude current category)
    if (category_name) {
      const existing = await repo.findOne({
        where: { category_name: category_name.trim() },
      });

      if (existing && existing.category_id !== parseInt(id)) {
        return res.status(409).json({
          message: "Category name already exists",
        });
      }
    }

    // 3b. Every requested site must exist before anything changes.
    if (targetSiteIds && targetSiteIds.length > 0) {
      const found = await siteRepo.findBy({ site_id: In(targetSiteIds) });
      if (found.length !== targetSiteIds.length) {
        return res.status(400).json({
          message: "One or more sites not found",
        });
      }
    }

    // 4️⃣ Update category
    const currentSiteIds = (category.sites || []).map((s) => s.site_id);
    if (category_name) category.category_name = category_name.trim();
    // Allow scope to be set to null or a value
    if (scope !== undefined) category.scope = scope ? scope.trim() : null;

    // Save only the columns; the site links are changed below through the
    // relation builder so a partial sites array never rewrites the join table.
    await repo.update(
      { category_id: category.category_id },
      { category_name: category.category_name, scope: category.scope ?? (null as any) }
    );

    // 5️⃣ Replace the site assignment when site_ids was sent.
    if (targetSiteIds) {
      const toAdd = targetSiteIds.filter((sid) => !currentSiteIds.includes(sid));
      const toUnlink = currentSiteIds.filter((sid) => !targetSiteIds!.includes(sid));
      const relation = repo.createQueryBuilder().relation(Category, "sites").of(category.category_id);

      if (toAdd.length > 0) {
        await relation.add(toAdd);
        for (const siteId of toAdd) {
          await grantCategoriesToSiteUsers(siteId, [category]);
        }
      }
      if (toUnlink.length > 0) {
        // data-loss-reviewed: unlinks the category from sites the Superadmin unticked; entries, factors, configs and units are kept.
        await relation.remove(toUnlink);
      }
    }

    const updated = await repo.findOne({
      where: { category_id: category.category_id },
      relations: ["sites"],
    });

    return res.status(200).json({
      message: "Category updated successfully",
      category: updated,
    });
  } catch (error) {
    console.error("Update category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const categoryId = parseInt(req.params.id as string);

    // 1️⃣ Check if category exists
    const category = await repo.findOne({
      where: { category_id: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    // 1b. Refuse to delete a category that is still in use unless force=true.
    const force =
      String(req.body?.force ?? "").toLowerCase() === "true" ||
      String(req.query?.force ?? "").toLowerCase() === "true";
    if (!force) {
      const inUse = (await loadCategoryUsage([categoryId])).get(categoryId) ?? {
        sites: 0, entries: 0, factors: 0, configs: 0, units: 0,
      };
      const parts = [
        [inUse.sites, "site(s)"],
        [inUse.entries, "entries"],
        [inUse.factors, "emission factors"],
        [inUse.configs, "column configs"],
        [inUse.units, "units"],
      ]
        .filter(([n]) => (n as number) > 0)
        .map(([n, label]) => `${n} ${label}`);
      if (parts.length > 0) {
        return res.status(409).json({
          message: `This category is still in use: ${parts.join(", ")}.`,
          in_use: inUse,
        });
      }
    }

    // 2️⃣ Delete category. Several FKs do not cascade and would block the delete
    // (or the emission cascade), so unlink them first inside a transaction:
    //   - site_categories.category_id  (NO ACTION)
    //   - invoice.category_id          (NO ACTION)
    //   - invoice.emission_id          (NO ACTION) — points at emissions that
    //     get cascade-deleted with the category
    // Uploaded invoices are preserved (only unlinked). Everything else
    // (emission_factors, emissions, emission_document, column_config, unit,
    // user_categories) cascades via its own FK.
    await AppDataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE invoice SET emission_id = NULL
           WHERE emission_id IN (SELECT pk_id FROM emission WHERE category_id = $1)`,
        [categoryId]
      );
      await manager.query(`UPDATE invoice SET category_id = NULL WHERE category_id = $1`, [categoryId]);
      await manager.query(`DELETE FROM site_categories WHERE category_id = $1`, [categoryId]);
      await manager.delete(Category, { category_id: categoryId });
    });

    return res.status(200).json({
      message: "Category deleted successfully",
    });
  } catch (error: any) {
    console.error("Delete category error:", error);
    // A remaining non-cascading reference (e.g. invoices) blocks the delete.
    if (error?.code === "23503") {
      return res.status(409).json({
        message:
          "Cannot delete category: it is still referenced by other records (e.g. invoices). Remove those first.",
      });
    }
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};