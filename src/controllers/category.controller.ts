import { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { Category } from "../entities/Category";
import { Site } from "../entities/Site";
import { grantCategoriesToSiteUsers } from "../utils/siteCategorySync";

const repo = AppDataSource.getRepository(Category);
const siteRepo = AppDataSource.getRepository(Site);

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

    return res.status(200).json(categories);
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
    const { category_name, scope } = req.body;

    // 1️⃣ Validate input
    if (!category_name && !scope) {
      return res.status(400).json({
        message: "At least one field (category_name or scope) is required",
      });
    }

    // 2️⃣ Check if category exists
    const category = await repo.findOne({
      where: { category_id: parseInt(id) },
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

    // 4️⃣ Update category
    if (category_name) category.category_name = category_name.trim();
    // Allow scope to be set to null or a value
    if (scope !== undefined) category.scope = scope ? scope.trim() : null;

    await repo.save(category);

    return res.status(200).json({
      message: "Category updated successfully",
      category,
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