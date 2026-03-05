import { Request, Response } from "express";
import { IsNull } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { EmissionCategoryMapping } from "../entities/EmissionCategoryMapping";
import { EmissionFactor } from "../entities/EmissionFactor";

const repo = AppDataSource.getRepository(EmissionCategoryMapping);
const efRepo = AppDataSource.getRepository(EmissionFactor);

// Auto-match: find emission factor by company_category_name OR global_category_name
// against both emission_category_name and global_category_name in emission_factors
const autoMatchEmissionFactor = async (
  companyCategoryName: string,
  globalCategoryName: string,
  categoryId: number,
  siteId?: number | null
): Promise<number | null> => {
  const companyTrimmed = companyCategoryName.trim();
  const globalTrimmed = globalCategoryName.trim();

  // Build all possible where conditions
  const buildWhere = (extraWhere?: Record<string, any>) => [
    { emission_category_name: companyTrimmed, category: { category_id: categoryId }, ...extraWhere },
    { emission_category_name: globalTrimmed, category: { category_id: categoryId }, ...extraWhere },
    { global_category_name: companyTrimmed, category: { category_id: categoryId }, ...extraWhere },
    { global_category_name: globalTrimmed, category: { category_id: categoryId }, ...extraWhere },
  ];

  // Try site-specific match first
  if (siteId) {
    const siteMatch = await efRepo.findOne({
      where: buildWhere({ site: { site_id: siteId } }),
    });
    if (siteMatch) return siteMatch.emission_factor_id;
  }

  // Fall back to any match with same category
  const anyMatch = await efRepo.findOne({
    where: buildWhere(),
  });

  return anyMatch?.emission_factor_id ?? null;
};

// List all mappings with optional filters
export const getMappings = async (req: Request, res: Response) => {
  try {
    const { company_id, site_id, category_id, global_category_name } = req.query;

    const where: any = {};
    if (company_id) where.company_id = parseInt(company_id as string);
    if (site_id) where.site_id = parseInt(site_id as string);
    if (category_id) where.category_id = parseInt(category_id as string);
    if (global_category_name) where.global_category_name = global_category_name;

    const mappings = await repo.find({
      where,
      order: { company_name: "ASC", company_category_name: "ASC" },
    });

    return res.status(200).json(mappings);
  } catch (error) {
    console.error("Fetch category mappings error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get mappings by company (with two-tier site resolution)
export const getMappingsByCompany = async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    const siteId = req.query.site_id
      ? parseInt(req.query.site_id as string)
      : undefined;
    const categoryId = req.query.category_id
      ? parseInt(req.query.category_id as string)
      : undefined;

    let mappings: EmissionCategoryMapping[];

    const baseWhere: any = { company_id: companyId };
    if (categoryId) baseWhere.category_id = categoryId;

    if (siteId) {
      // Get both site-specific and company-wide (site_id IS NULL)
      mappings = await repo.find({
        where: [
          { ...baseWhere, site_id: siteId },
          { ...baseWhere, site_id: IsNull() },
        ],
        order: { company_category_name: "ASC" },
      });

      // Two-tier resolution: site-specific wins over company-wide
      const resolved = new Map<string, EmissionCategoryMapping>();
      for (const m of mappings) {
        const key = m.company_category_name;
        const existing = resolved.get(key);
        // Site-specific (non-null site_id) takes priority
        if (!existing || (m.site_id !== null && existing.site_id === null)) {
          resolved.set(key, m);
        }
      }
      mappings = Array.from(resolved.values());
    } else {
      mappings = await repo.find({
        where: baseWhere,
        order: { company_category_name: "ASC" },
      });
    }

    return res.status(200).json(mappings);
  } catch (error) {
    console.error("Fetch mappings by company error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Resolve: given global_category_name + company_id → company_category_name
export const resolveCompanyCategory = async (req: Request, res: Response) => {
  try {
    const { global_category_name, company_id, site_id, category_id } = req.query;

    if (!global_category_name || !company_id || !category_id) {
      return res.status(400).json({
        message: "global_category_name, company_id, and category_id are required",
      });
    }

    const companyId = parseInt(company_id as string);
    const catId = parseInt(category_id as string);
    const sId = site_id ? parseInt(site_id as string) : undefined;

    // Try site-specific first, then company-wide
    const where: any[] = [];
    if (sId) {
      where.push({
        company_id: companyId,
        category_id: catId,
        site_id: sId,
        global_category_name,
      });
    }
    where.push({
      company_id: companyId,
      category_id: catId,
      site_id: IsNull(),
      global_category_name,
    });

    const mapping = await repo.findOne({
      where,
      order: { site_id: "DESC" }, // non-null (site-specific) first
    });

    if (!mapping) {
      return res.status(200).json({ company_category_name: null });
    }

    return res.status(200).json({
      company_category_name: mapping.company_category_name,
      mapping,
    });
  } catch (error) {
    console.error("Resolve company category error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Bulk resolve: given array of global_category_names + company_id → map of results
export const bulkResolveCompanyCategories = async (req: Request, res: Response) => {
  try {
    const { global_category_names, company_id, site_id, category_id } = req.body;

    if (!global_category_names || !company_id || !category_id) {
      return res.status(400).json({
        message: "global_category_names array, company_id, and category_id are required",
      });
    }

    const companyId = parseInt(company_id);
    const catId = parseInt(category_id);
    const sId = site_id ? parseInt(site_id) : undefined;

    // Fetch all mappings for this company + category at once
    const where: any[] = [];
    if (sId) {
      where.push({ company_id: companyId, category_id: catId, site_id: sId });
    }
    where.push({ company_id: companyId, category_id: catId, site_id: IsNull() });

    const allMappings = await repo.find({ where });

    // Build lookup: global_category_name → company_category_name (site-specific wins)
    const lookup = new Map<string, string>();
    // First pass: company-wide
    for (const m of allMappings) {
      if (m.site_id === null) {
        lookup.set(m.global_category_name, m.company_category_name);
      }
    }
    // Second pass: site-specific overrides
    for (const m of allMappings) {
      if (m.site_id !== null) {
        lookup.set(m.global_category_name, m.company_category_name);
      }
    }

    const result: Record<string, string | null> = {};
    for (const name of global_category_names) {
      result[name] = lookup.get(name) ?? null;
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Bulk resolve company categories error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Create single mapping
export const createMapping = async (req: Request, res: Response) => {
  try {
    const {
      company_id,
      company_name,
      site_id,
      category_id,
      company_category_name,
      global_category_name,
      created_by,
    } = req.body;

    if (!company_id || !company_name || !category_id || !company_category_name || !global_category_name) {
      return res.status(400).json({
        message: "company_id, company_name, category_id, company_category_name, and global_category_name are required",
      });
    }

    // Check for duplicate
    const existing = await repo.findOne({
      where: {
        company_id,
        site_id: site_id ?? IsNull(),
        category_id,
        company_category_name,
      },
    });

    if (existing) {
      return res.status(400).json({
        message: `Mapping already exists for "${company_category_name}" in this company/site/category`,
      });
    }

    // Auto-match emission factor
    const matchedEfId = await autoMatchEmissionFactor(
      company_category_name,
      global_category_name,
      category_id,
      site_id ?? null
    );

    const mapping = repo.create({
      company_id,
      company_name: company_name.trim(),
      site_id: site_id ?? null,
      category_id,
      company_category_name: company_category_name.trim(),
      global_category_name: global_category_name.trim(),
      emission_factor_id: matchedEfId ?? undefined,
      created_by: created_by ?? null,
    });

    await repo.save(mapping);

    return res.status(201).json({
      message: "Mapping created successfully",
      mapping,
    });
  } catch (error) {
    console.error("Create category mapping error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update mapping
export const updateMapping = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { company_category_name, global_category_name, site_id, emission_factor_id } = req.body;

    const mapping = await repo.findOne({ where: { id } });
    if (!mapping) {
      return res.status(404).json({ message: "Mapping not found" });
    }

    if (company_category_name !== undefined)
      mapping.company_category_name = company_category_name.trim();
    if (global_category_name !== undefined)
      mapping.global_category_name = global_category_name.trim();
    if (site_id !== undefined) mapping.site_id = site_id;
    if (emission_factor_id !== undefined) mapping.emission_factor_id = emission_factor_id;

    await repo.save(mapping);

    return res.status(200).json({
      message: "Mapping updated successfully",
      mapping,
    });
  } catch (error) {
    console.error("Update category mapping error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete mapping
export const deleteMapping = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);

    const mapping = await repo.findOne({ where: { id } });
    if (!mapping) {
      return res.status(404).json({ message: "Mapping not found" });
    }

    await repo.delete({ id });

    return res.status(200).json({ message: "Mapping deleted successfully" });
  } catch (error) {
    console.error("Delete category mapping error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Bulk create mappings
export const bulkCreateMappings = async (req: Request, res: Response) => {
  try {
    const { mappings } = req.body;

    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({
        message: "mappings array is required and must not be empty",
      });
    }

    const results = {
      created: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const row of mappings) {
      const {
        company_id,
        company_name,
        site_id,
        category_id,
        company_category_name,
        global_category_name,
        created_by,
      } = row;

      if (!company_id || !company_name || !category_id || !company_category_name || !global_category_name) {
        results.errors.push(
          `Missing required fields for "${company_category_name || "unknown"}"`
        );
        results.skipped++;
        continue;
      }

      // Check for duplicate
      const existing = await repo.findOne({
        where: {
          company_id,
          site_id: site_id ?? IsNull(),
          category_id,
          company_category_name: company_category_name.trim(),
        },
      });

      if (existing) {
        results.errors.push(
          `Mapping already exists for "${company_category_name}" in company ${company_name}`
        );
        results.skipped++;
        continue;
      }

      // Auto-match emission factor
      const matchedEfId = await autoMatchEmissionFactor(
        company_category_name,
        global_category_name,
        category_id,
        site_id ?? null
      );

      const mapping = repo.create({
        company_id,
        company_name: company_name.trim(),
        site_id: site_id ?? null,
        category_id,
        company_category_name: company_category_name.trim(),
        global_category_name: global_category_name.trim(),
        emission_factor_id: matchedEfId ?? undefined,
        created_by: created_by ?? null,
      });

      await repo.save(mapping);
      results.created++;
    }

    return res.status(201).json({
      message: `Bulk create completed: ${results.created} created, ${results.skipped} skipped`,
      ...results,
    });
  } catch (error) {
    console.error("Bulk create category mappings error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Bulk delete mappings
export const bulkDeleteMappings = async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "Please provide an array of mapping IDs to delete",
      });
    }

    const result = await repo.delete(ids);

    return res.status(200).json({
      message: `Successfully deleted ${result.affected} mapping(s)`,
      deleted: result.affected,
    });
  } catch (error) {
    console.error("Bulk delete category mappings error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
