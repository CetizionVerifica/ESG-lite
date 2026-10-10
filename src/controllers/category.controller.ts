import { Request, Response } from "express";
import { EntityManager, In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { Category } from "../entities/Category";
import { Site } from "../entities/Site";
import { grantCategoriesToSiteUsers } from "../utils/siteCategorySync";
import { pcfDataChanged } from "../pcf/staleness";

const repo = AppDataSource.getRepository(Category);
const siteRepo = AppDataSource.getRepository(Site);

type CategoryUsage = {
  sites: number;
  entries: number;
  factors: number;
  configs: number;
  units: number;
  mappings: number;
  invoices: number;
  users: number;
};

// Per-category usage counts in one statement (correlated subqueries, no N+1).
// Units link to a category through unit.category_id (no inverse relation on
// Category), entries are emission rows. Client category mappings and invoices
// point at a category without a cascading FK, so they count as use too. So
// does a user's category grant: deleting it could empty the grant set, and an
// empty set means full access.
const loadCategoryUsage = async (
  categoryIds?: number[],
  manager: EntityManager = AppDataSource.manager
): Promise<Map<number, CategoryUsage>> => {
  const params: any[] = [];
  let where = "";
  if (categoryIds) {
    params.push(categoryIds);
    where = "WHERE c.category_id = ANY($1::int[])";
  }
  const rows: any[] = await manager.query(
    `SELECT c.category_id,
            (SELECT COUNT(*) FROM site_categories sc WHERE sc.category_id = c.category_id)::int AS sites,
            (SELECT COUNT(*) FROM emission e WHERE e.category_id = c.category_id)::int AS entries,
            (SELECT COUNT(*) FROM emission_factors f WHERE f.category_id = c.category_id)::int AS factors,
            (SELECT COUNT(*) FROM column_config cc WHERE cc.category_id = c.category_id)::int AS configs,
            (SELECT COUNT(*) FROM unit u WHERE u.category_id = c.category_id)::int AS units,
            (SELECT COUNT(*) FROM emission_category_mapping m WHERE m.category_id = c.category_id)::int AS mappings,
            (SELECT COUNT(*) FROM invoice i WHERE i.category_id = c.category_id)::int AS invoices,
            (SELECT COUNT(*) FROM user_categories uc WHERE uc.category_id = c.category_id)::int AS users
       FROM category c ${where}`,
    params
  );
  return new Map(
    rows.map((r) => [
      Number(r.category_id),
      {
        sites: r.sites,
        entries: r.entries,
        factors: r.factors,
        configs: r.configs,
        units: r.units,
        mappings: r.mappings,
        invoices: r.invoices,
        users: r.users,
      },
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
    const oldScope = category.scope;
    if (scope !== undefined) category.scope = scope ? scope.trim() : null;

    // Columns, site links and user grants change together or not at all.
    await AppDataSource.transaction(async (manager) => {
      // Save only the columns; the site links are changed below through the
      // relation builder so a partial sites array never rewrites the join table.
      await manager.update(
        Category,
        { category_id: category.category_id },
        { category_name: category.category_name, scope: category.scope ?? (null as any) }
      );

      // 5️⃣ Replace the site assignment when site_ids was sent.
      if (targetSiteIds) {
        const toAdd = targetSiteIds.filter((sid) => !currentSiteIds.includes(sid));
        const toUnlink = currentSiteIds.filter((sid) => !targetSiteIds!.includes(sid));
        const relation = manager.createQueryBuilder().relation(Category, "sites").of(category.category_id);

        if (toAdd.length > 0) {
          await relation.add(toAdd);
          for (const siteId of toAdd) {
            await grantCategoriesToSiteUsers(siteId, [category], manager);
          }
        }
        if (toUnlink.length > 0) {
          // data-loss-reviewed: unlinks the category from sites the Superadmin unticked; entries, factors, configs and units are kept.
          await relation.remove(toUnlink);
        }
      }
    });

    const updated = await repo.findOne({
      where: { category_id: category.category_id },
      relations: ["sites"],
    });

    // A scope change moves this category's emissions in or out of plant Scope 1+2 (PCF A3 energy).
    if (category.scope !== oldScope) {
      const rows: { pk_id: number }[] = await AppDataSource.query(`SELECT pk_id FROM emission WHERE category_id = $1`, [category.category_id]);
      await pcfDataChanged("emission", rows.map((r) => r.pk_id));
    }

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

    // 2️⃣ Delete only a category nothing uses. The row is locked and the usage
    // counted inside the transaction, so nothing can start using it in between.
    // Unused means no site links, entries, factors, configs, units, client
    // mappings or invoices, so nothing cascades with it.
    let emissionIds: number[] = [];
    const inUse = await AppDataSource.transaction(async (manager) => {
      await manager.query(`SELECT category_id FROM category WHERE category_id = $1 FOR UPDATE`, [categoryId]);
      const usage = (await loadCategoryUsage([categoryId], manager)).get(categoryId);
      const parts = usage
        ? ([
            [usage.sites, "site(s)"],
            [usage.entries, "entries"],
            [usage.factors, "emission factors"],
            [usage.configs, "column configs"],
            [usage.units, "units"],
            [usage.mappings, "client category mappings"],
            [usage.invoices, "invoices"],
            [usage.users, "user category grants"],
          ] as [number, string][])
            .filter(([n]) => n > 0)
            .map(([n, label]) => `${n} ${label}`)
        : [];
      if (parts.length > 0) return { usage, parts };
      // The guard means no entries, but collect them anyway so footprints that
      // used any go stale if the rule ever changes.
      emissionIds = (
        await manager.query(`SELECT pk_id FROM emission WHERE category_id = $1`, [categoryId])
      ).map((r: { pk_id: number }) => r.pk_id);
      // data-loss-reviewed: deletes only a category with no usage counted above (Shyam: delete only when unused).
      await manager.delete(Category, { category_id: categoryId });
      return null;
    });

    if (inUse) {
      return res.status(409).json({
        message: `This category is still in use: ${inUse.parts.join(", ")}.`,
        in_use: inUse.usage,
      });
    }

    await pcfDataChanged("emission", emissionIds);

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