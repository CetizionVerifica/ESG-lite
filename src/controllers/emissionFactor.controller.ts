import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { AppDataSource } from "../config/data-source";
import { EmissionFactor } from "../entities/EmissionFactor";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";

const repo = AppDataSource.getRepository(EmissionFactor);
const siteRepo = AppDataSource.getRepository(Site);
const categoryRepo = AppDataSource.getRepository(Category);

// Canonical unit normalization — maps common variants to a single lowercase form
const UNIT_ALIASES: Record<string, string> = {
  tonnes: "tonne",
  tons: "ton",
  litres: "litre",
  liters: "litre",
  liter: "litre",
  gallons: "gallon",
  "kilo litre": "kl",
  "kilolitre": "kl",
  "kiloliter": "kl",
  "cubic meter": "cubic meter",
  "cubic metre": "cubic meter",
  "m3": "cubic meter",
  "m³": "cubic meter",
  kilogram: "kg",
  kilograms: "kg",
  kgs: "kg",
  gram: "g",
  grams: "g",
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  kilometer: "km",
  kilometers: "km",
  kilometre: "km",
  kilometres: "km",
  miles: "mile",
  mi: "mile",
};

function normalizeUnit(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  // Strip parentheses and extra whitespace
  let cleaned = raw.replace(/[()]/g, "").trim().toLowerCase();
  // Handle full UOM strings like "kg CO2 e/ passenger.km" — extract denominator after "/"
  if (cleaned.includes("/")) {
    cleaned = cleaned.split("/").pop()!.trim();
  }
  return UNIT_ALIASES[cleaned] || cleaned;
}

export const getEmissionFactors = async (_: Request, res: Response) => {
  try {
    const emissionFactors = await repo.find({
      relations: ["site", "category"],
      order: { year: "DESC", emission_factor_id: "ASC" },
    });
    return res.status(200).json(emissionFactors);
  } catch (error) {
    console.error("Fetch emission factors error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getEmissionFactorById = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const emissionFactor = await repo.findOne({
      where: { emission_factor_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emissionFactor) {
      return res.status(404).json({
        message: "Emission factor not found",
      });
    }

    return res.status(200).json(emissionFactor);
  } catch (error) {
    console.error("Fetch emission factor error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const createEmissionFactor = async (req: Request, res: Response) => {
  try {
    const { site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name } = req.body;

    if (!site_id || !category_id || !year || factor_value === undefined) {
      return res.status(400).json({
        message: "site_id, category_id, year, and factor_value are required",
      });
    }

    // Validate site exists
    const site = await siteRepo.findOne({ where: { site_id } });
    if (!site) {
      return res.status(400).json({
        message: "Site not found",
      });
    }

    // Validate category exists
    const category = await categoryRepo.findOne({ where: { category_id } });
    if (!category) {
      return res.status(400).json({
        message: "Category not found",
      });
    }

    // Check for duplicate (site + category + year must be unique)
    const existing = await repo.findOne({
      where: {
        site: { site_id },
        category: { category_id },
        year,
        emission_category_name 
      },
    });


    if (existing) {
      return res.status(400).json({
        message: "Emission factor already exists for this site, category, and year",
      });
    }

    const emissionFactor = repo.create({
      site: { site_id },
      category: { category_id },
      year,
      factor_value,
      denominator_unit: normalizeUnit(denominator_unit),
      source: source?.trim() || null,
      emission_category_name: emission_category_name?.trim() || null,
    });

    await repo.save(emissionFactor);

    // Fetch with relations for response
    const savedFactor = await repo.findOne({
      where: { emission_factor_id: emissionFactor.emission_factor_id },
      relations: ["site", "category"],
    });

    return res.status(201).json({
      message: "Emission factor created successfully",
      emissionFactor: savedFactor,
    });
  } catch (error) {
    console.error("Create emission factor error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const updateEmissionFactor = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name } = req.body;

    if (
      site_id === undefined &&
      category_id === undefined &&
      year === undefined &&
      factor_value === undefined &&
      denominator_unit === undefined &&
      source === undefined &&
      emission_category_name === undefined
    ) {
      return res.status(400).json({
        message: "At least one field is required for update",
      });
    }

    const emissionFactor = await repo.findOne({
      where: { emission_factor_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emissionFactor) {
      return res.status(404).json({
        message: "Emission factor not found",
      });
    }

    // Validate site if provided
    if (site_id !== undefined) {
      const site = await siteRepo.findOne({ where: { site_id } });
      if (!site) {
        return res.status(400).json({
          message: "Site not found",
        });
      }
      emissionFactor.site = { site_id } as any;
    }

    // Validate category if provided
    if (category_id !== undefined) {
      const category = await categoryRepo.findOne({ where: { category_id } });
      if (!category) {
        return res.status(400).json({
          message: "Category not found",
        });
      }
      emissionFactor.category = { category_id } as any;
    }

    // Check for duplicate if updating site, category, or year
    if (site_id !== undefined || category_id !== undefined || year !== undefined) {
      const checkSiteId = site_id ?? emissionFactor.site.site_id;
      const checkCategoryId = category_id ?? emissionFactor.category.category_id;
      const checkYear = year ?? emissionFactor.year;

      const existing = await repo.findOne({
        where: {
          site: { site_id: checkSiteId },
          category: { category_id: checkCategoryId },
          year: checkYear,
        },
      });

      if (existing && existing.emission_factor_id !== emissionFactor.emission_factor_id) {
        return res.status(400).json({
          message: "Emission factor already exists for this site, category, and year",
        });
      }
    }

    if (year !== undefined) emissionFactor.year = year;
    if (factor_value !== undefined) emissionFactor.factor_value = factor_value;
    if (denominator_unit !== undefined) emissionFactor.denominator_unit = (normalizeUnit(denominator_unit) ?? null) as any;
    if (source !== undefined) emissionFactor.source = source?.trim() || null;
    if (emission_category_name !== undefined) emissionFactor.emission_category_name = emission_category_name?.trim() || null;

    await repo.save(emissionFactor);

    // Fetch with relations for response
    const updatedFactor = await repo.findOne({
      where: { emission_factor_id: emissionFactor.emission_factor_id },
      relations: ["site", "category"],
    });

    return res.status(200).json({
      message: "Emission factor updated successfully",
      emissionFactor: updatedFactor,
    });
  } catch (error) {
    console.error("Update emission factor error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const deleteEmissionFactor = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const emissionFactor = await repo.findOne({
      where: { emission_factor_id: parseInt(id) },
    });

    if (!emissionFactor) {
      return res.status(404).json({
        message: "Emission factor not found",
      });
    }

    await repo.delete({ emission_factor_id: parseInt(id) });

    return res.status(200).json({
      message: "Emission factor deleted successfully",
    });
  } catch (error) {
    console.error("Delete emission factor error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get emission factors by site
export const getEmissionFactorsBySite = async (req: Request, res: Response) => {
  try {
    const { siteId }: any = req.params;

    const emissionFactors = await repo.find({
      where: { site: { site_id: parseInt(siteId) } },
      relations: ["site", "category"],
      order: { year: "DESC" },
    });

    return res.status(200).json(emissionFactors);
  } catch (error) {
    console.error("Fetch emission factors by site error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get emission factors by category
export const getEmissionFactorsByCategory = async (req: Request, res: Response) => {
  try {
    const { categoryId }: any = req.params;

    const emissionFactors = await repo.find({
      where: { category: { category_id: parseInt(categoryId) } },
      relations: ["site", "category"],
      order: { year: "DESC" },
    });

    return res.status(200).json(emissionFactors);
  } catch (error) {
    console.error("Fetch emission factors by category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get emission factors by site and category (with optional year filter)
export const getEmissionFactorsBySiteAndCategory = async (req: Request, res: Response) => {
  try {
    const { siteId, categoryId }: any = req.params;
    const { year } = req.query;

    // Build where clause
    const whereClause: any = {
      site: { site_id: parseInt(siteId) },
      category: { category_id: parseInt(categoryId) },
    };

    // Add year filter if provided
    if (year) {
      whereClause.year = parseInt(year as string);
    }

    const emissionFactors = await repo.find({
      where: whereClause,
      relations: ["site", "category"],
      order: { year: "DESC" },
    });

    return res.status(200).json(emissionFactors);
  } catch (error) {
    console.error("Fetch emission factors by site and category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk create emission factors
export const bulkCreateEmissionFactors = async (req: Request, res: Response) => {
  try {
    const { factors, upload_batch_id: clientBatchId } = req.body;

    if (!factors || !Array.isArray(factors) || factors.length === 0) {
      return res.status(400).json({
        message: "factors array is required and must not be empty",
      });
    }

    // Use client-provided batch ID (for chunked uploads sharing one ID) or generate one
    const upload_batch_id = clientBatchId || randomUUID();

    const results = {
      created: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const factor of factors) {
      const { site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name } = factor;

      // Validate required fields
      if (!site_id || !category_id || !year || factor_value === undefined) {
        results.errors.push(`Missing required fields for row with year ${year || "unknown"}`);
        results.skipped++;
        continue;
      }

      // Validate site exists
      const site = await siteRepo.findOne({ where: { site_id } });
      if (!site) {
        results.errors.push(`Site with id ${site_id} not found`);
        results.skipped++;
        continue;
      }

      // Validate category exists
      const category = await categoryRepo.findOne({ where: { category_id } });
      if (!category) {
        results.errors.push(`Category with id ${category_id} not found`);
        results.skipped++;
        continue;
      }

      // Check for duplicate
      const existing = await repo.findOne({
        where: {
          site: { site_id },
          category: { category_id },
          year,
          emission_category_name: emission_category_name || undefined,
        },
      });

      if (existing) {
        results.errors.push(`Emission factor already exists for site ${site_id}, category ${category_id}, year ${year}, emission category "${emission_category_name || "N/A"}"`);
        results.skipped++;
        continue;
      }

      // Create emission factor
      const emissionFactor = repo.create({
        site: { site_id },
        category: { category_id },
        year,
        factor_value,
        denominator_unit: normalizeUnit(denominator_unit),
        source: source?.trim() || null,
        emission_category_name: emission_category_name?.trim() || null,
        global_category_name: global_category_name?.trim() || null,
        upload_batch_id,
      });

      await repo.save(emissionFactor);
      results.created++;
    }

    return res.status(201).json({
      message: `Bulk upload completed: ${results.created} created, ${results.skipped} skipped`,
      upload_batch_id: results.created > 0 ? upload_batch_id : undefined,
      ...results,
    });
  } catch (error) {
    console.error("Bulk create emission factors error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get distinct emission_category_name values by site and/or category
export const getEmissionCategoryNames = async (req: Request, res: Response) => {
  try {
    const { site_id, category_id } = req.query;

    if (!category_id) {
      return res.status(400).json({
        message: "category_id query parameter is required",
      });
    }

    const qb = repo
      .createQueryBuilder("ef")
      .select("DISTINCT ef.emission_category_name", "emission_category_name")
      .where("ef.category_id = :categoryId", { categoryId: parseInt(category_id as string) })
      .andWhere("ef.emission_category_name IS NOT NULL");

    if (site_id) {
      qb.andWhere("ef.site_id = :siteId", { siteId: parseInt(site_id as string) });
    }

    const names = await qb
      .orderBy("ef.emission_category_name", "ASC")
      .getRawMany();

    return res.status(200).json(
      names.map((n: any) => n.emission_category_name)
    );
  } catch (error) {
    console.error("Fetch emission category names error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk delete emission factors
export const bulkDeleteEmissionFactors = async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "Please provide an array of emission factor IDs to delete",
      });
    }

    const result = await repo.delete(ids);

    return res.status(200).json({
      message: `Successfully deleted ${result.affected} emission factor(s)`,
      deleted: result.affected,
    });
  } catch (error) {
    console.error("Bulk delete emission factors error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// List upload batches with aggregated info
export const getEmissionFactorBatches = async (req: Request, res: Response) => {
  try {
    const { site_id, category_id } = req.query;

    const qb = repo
      .createQueryBuilder("ef")
      .select("ef.upload_batch_id", "upload_batch_id")
      .addSelect("COUNT(*)::int", "count")
      .addSelect("MIN(ef.created_at)", "uploaded_at")
      .addSelect("ef.site_id", "site_id")
      .addSelect("site.name", "site_name")
      .addSelect("ef.category_id", "category_id")
      .addSelect("category.category_name", "category_name")
      .innerJoin("ef.site", "site")
      .innerJoin("ef.category", "category")
      .where("ef.upload_batch_id IS NOT NULL")
      .groupBy("ef.upload_batch_id")
      .addGroupBy("ef.site_id")
      .addGroupBy("site.name")
      .addGroupBy("ef.category_id")
      .addGroupBy("category.category_name")
      .orderBy("MIN(ef.created_at)", "DESC");

    if (site_id) {
      qb.andWhere("ef.site_id = :siteId", { siteId: parseInt(site_id as string) });
    }
    if (category_id) {
      qb.andWhere("ef.category_id = :categoryId", { categoryId: parseInt(category_id as string) });
    }

    const batches = await qb.getRawMany();
    return res.status(200).json(batches);
  } catch (error) {
    console.error("Get emission factor batches error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete all emission factors for a given upload batch
export const deleteEmissionFactorsByBatch = async (req: Request, res: Response) => {
  try {
    const batchId = req.params.batchId as string;
    if (!batchId) {
      return res.status(400).json({ message: "batchId is required" });
    }

    const result = await repo.delete({ upload_batch_id: batchId });

    return res.status(200).json({
      message: `Deleted ${result.affected} emission factor(s) from batch`,
      deleted: result.affected,
    });
  } catch (error) {
    console.error("Delete emission factors by batch error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
