import { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { ProductionData, ProductionDataStatus } from "../entities/ProductionData";
import { Product } from "../entities/Product";
import { Emission, EmissionStatus } from "../entities/Emission";
import { AuthRequest } from "../middlewares/auth.middleware";

const repo = AppDataSource.getRepository(ProductionData);
const productRepo = AppDataSource.getRepository(Product);
const emissionRepo = AppDataSource.getRepository(Emission);

// Create production data entry
export const createProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const { product_id, site_id, quantity, unit, start_date, end_date, notes } = req.body;
    const userId = req.user?.userId;

    if (!product_id || !site_id || !quantity || !unit || !start_date || !end_date) {
      return res.status(400).json({
        message: "product_id, site_id, quantity, unit, start_date, and end_date are required",
      });
    }

    // Validate date range
    if (new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({
        message: "start_date cannot be after end_date",
      });
    }

    // Verify product exists and belongs to site
    const product = await productRepo.findOne({
      where: { product_id, site: { site_id } },
    });

    if (!product) {
      return res.status(404).json({
        message: "Product not found or does not belong to this site",
      });
    }

    const productionData = repo.create({
      product: { product_id },
      site: { site_id },
      quantity: parseFloat(quantity),
      unit: unit.trim(),
      start_date: new Date(start_date),
      end_date: new Date(end_date),
      notes: notes?.trim() || null,
      created_by: userId ? { user_id: userId } : (null as any),
    });

    await repo.save(productionData);

    const saved = await repo.findOne({
      where: { production_id: productionData.production_id },
      relations: ["product", "site", "created_by"],
    });

    return res.status(201).json({
      message: "Production data created successfully",
      productionData: saved,
    });
  } catch (error) {
    console.error("Create production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get production data by site
export const getProductionDataBySite = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;
    const { startDate, endDate, productId } = req.query;

    const queryBuilder = repo
      .createQueryBuilder("pd")
      .leftJoinAndSelect("pd.product", "product")
      .leftJoinAndSelect("pd.site", "site")
      .leftJoinAndSelect("pd.created_by", "created_by")
      .where("pd.site_id = :siteId", { siteId: parseInt(siteId) });

    if (productId) {
      queryBuilder.andWhere("pd.product_id = :productId", {
        productId: parseInt(productId as string),
      });
    }

    if (startDate && endDate) {
      // Filter production data that overlaps with the requested date range
      queryBuilder.andWhere(
        "(pd.start_date <= :endDate AND pd.end_date >= :startDate)",
        {
          startDate: new Date(startDate as string),
          endDate: new Date(endDate as string),
        }
      );
    }

    const data = await queryBuilder.orderBy("pd.start_date", "DESC").getMany();

    return res.status(200).json(data);
  } catch (error) {
    console.error("Fetch production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update production data
export const updateProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { quantity, unit, start_date, end_date, notes } = req.body;

    const data = await repo.findOne({
      where: { production_id: parseInt(id) },
      relations: ["product", "site"],
    });

    if (!data) {
      return res.status(404).json({ message: "Production data not found" });
    }

    // Validate date range if both dates are provided
    const newStartDate = start_date ? new Date(start_date) : data.start_date;
    const newEndDate = end_date ? new Date(end_date) : data.end_date;
    if (newStartDate > newEndDate) {
      return res.status(400).json({
        message: "start_date cannot be after end_date",
      });
    }

    if (quantity !== undefined) data.quantity = parseFloat(quantity);
    if (unit) data.unit = unit.trim();
    if (start_date) data.start_date = new Date(start_date);
    if (end_date) data.end_date = new Date(end_date);
    if (notes !== undefined) data.notes = notes?.trim() || null;

    await repo.save(data);

    const updated = await repo.findOne({
      where: { production_id: data.production_id },
      relations: ["product", "site", "created_by"],
    });

    return res.status(200).json({
      message: "Production data updated successfully",
      productionData: updated,
    });
  } catch (error) {
    console.error("Update production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete production data
export const deleteProductionData = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const data = await repo.findOne({
      where: { production_id: parseInt(id) },
    });

    if (!data) {
      return res.status(404).json({ message: "Production data not found" });
    }

    await repo.delete({ production_id: parseInt(id) });

    return res.status(200).json({ message: "Production data deleted successfully" });
  } catch (error) {
    console.error("Delete production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Calculate emission intensity for a site
export const getEmissionIntensity = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;
    const { startDate, endDate, productId } = req.query;

    // Build date range
    let dateFilter: { startDate: Date; endDate: Date };
    if (startDate && endDate) {
      dateFilter = {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string),
      };
    } else {
      // Default to current year
      const currentYear = new Date().getFullYear();
      dateFilter = {
        startDate: new Date(currentYear, 0, 1),
        endDate: new Date(currentYear, 11, 31),
      };
    }

    // Get total emissions for the site (approved only, excluding null-scope categories like Renewable Electricity)
    const emissionsQuery = emissionRepo
      .createQueryBuilder("emission")
      .leftJoin("emission.category", "category")
      .select("SUM(emission.total_emission)", "totalEmissions")
      .where("emission.site_id = :siteId", { siteId: parseInt(siteId) })
      .andWhere("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("emission.date_of_reporting BETWEEN :startDate AND :endDate", dateFilter)
      .andWhere("category.scope IS NOT NULL"); // Exclude null-scope categories

    const emissionsResult = await emissionsQuery.getRawOne();
    const totalEmissions = parseFloat(emissionsResult?.totalEmissions || 0);

    // Get total production for the site (where production period overlaps with filter)
    const productionQuery = repo
      .createQueryBuilder("pd")
      .select("SUM(pd.quantity)", "totalProduction")
      .addSelect("pd.unit", "unit")
      .where("pd.site_id = :siteId", { siteId: parseInt(siteId) })
      .andWhere("pd.start_date <= :endDate AND pd.end_date >= :startDate", dateFilter);

    if (productId) {
      productionQuery.andWhere("pd.product_id = :productId", {
        productId: parseInt(productId as string),
      });
    }

    productionQuery.groupBy("pd.unit");

    const productionResults = await productionQuery.getRawMany();

    // Calculate intensity for each unit type
    const intensityByUnit = productionResults.map((p) => ({
      unit: p.unit,
      totalProduction: parseFloat(p.totalProduction || 0),
      emissionIntensity:
        parseFloat(p.totalProduction || 0) > 0
          ? totalEmissions / parseFloat(p.totalProduction)
          : 0,
    }));

    // Get monthly breakdown
    const monthlyData = await getMonthlyIntensity(
      parseInt(siteId),
      dateFilter.startDate,
      dateFilter.endDate,
      productId ? parseInt(productId as string) : undefined
    );

    return res.status(200).json({
      totalEmissions,
      productionByUnit: intensityByUnit,
      monthlyData,
      dateRange: {
        startDate: dateFilter.startDate,
        endDate: dateFilter.endDate,
      },
    });
  } catch (error) {
    console.error("Calculate emission intensity error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Helper function for monthly intensity
async function getMonthlyIntensity(
  siteId: number,
  startDate: Date,
  endDate: Date,
  productId?: number
) {
  // Exclude null-scope categories (like Renewable Electricity) from monthly emissions
  const monthlyEmissions = await emissionRepo
    .createQueryBuilder("e")
    .leftJoin("e.category", "category")
    .select("DATE_TRUNC('month', e.date_of_reporting)", "month")
    .addSelect("SUM(e.total_emission)", "emissions")
    .where("e.site_id = :siteId", { siteId })
    .andWhere("e.status = :status", { status: EmissionStatus.APPROVED })
    .andWhere("e.date_of_reporting BETWEEN :startDate AND :endDate", { startDate, endDate })
    .andWhere("category.scope IS NOT NULL") // Exclude null-scope categories
    .groupBy("DATE_TRUNC('month', e.date_of_reporting)")
    .getRawMany();

  // For monthly breakdown, use start_date as the reference month
  let productionQuery = repo
    .createQueryBuilder("pd")
    .select("DATE_TRUNC('month', pd.start_date)", "month")
    .addSelect("SUM(pd.quantity)", "production")
    .where("pd.site_id = :siteId", { siteId })
    .andWhere("pd.start_date <= :endDate AND pd.end_date >= :startDate", { startDate, endDate });

  if (productId) {
    productionQuery = productionQuery.andWhere("pd.product_id = :productId", { productId });
  }

  const monthlyProduction = await productionQuery
    .groupBy("DATE_TRUNC('month', pd.start_date)")
    .getRawMany();

  // Merge emissions and production data by month
  const monthMap = new Map<string, { emissions: number; production: number; intensity: number }>();

  monthlyEmissions.forEach((e) => {
    const monthKey = new Date(e.month).toISOString().slice(0, 7);
    monthMap.set(monthKey, {
      emissions: parseFloat(e.emissions || 0),
      production: 0,
      intensity: 0,
    });
  });

  monthlyProduction.forEach((p) => {
    const monthKey = new Date(p.month).toISOString().slice(0, 7);
    const existing = monthMap.get(monthKey) || { emissions: 0, production: 0, intensity: 0 };
    existing.production = parseFloat(p.production || 0);
    monthMap.set(monthKey, existing);
  });

  // Calculate intensity for each month
  monthMap.forEach((value, key) => {
    value.intensity = value.production > 0 ? value.emissions / value.production : 0;
    monthMap.set(key, value);
  });

  return Array.from(monthMap.entries())
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// Get emission intensity for multiple sites (for manager comparison)
export const getEmissionIntensityComparison = async (req: Request, res: Response) => {
  try {
    const { siteIds, startDate, endDate } = req.query;

    if (!siteIds) {
      return res.status(400).json({ message: "siteIds query parameter is required" });
    }

    const siteIdArray = (siteIds as string).split(",").map((id) => parseInt(id.trim()));

    let dateFilter: { startDate: Date; endDate: Date };
    if (startDate && endDate) {
      dateFilter = {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string),
      };
    } else {
      const currentYear = new Date().getFullYear();
      dateFilter = {
        startDate: new Date(currentYear, 0, 1),
        endDate: new Date(currentYear, 11, 31),
      };
    }

    const results = await Promise.all(
      siteIdArray.map(async (siteId) => {
        // Get emissions (excluding null-scope categories like Renewable Electricity)
        const emissionsResult = await emissionRepo
          .createQueryBuilder("e")
          .leftJoin("e.category", "category")
          .select("SUM(e.total_emission)", "totalEmissions")
          .where("e.site_id = :siteId", { siteId })
          .andWhere("e.status = :status", { status: EmissionStatus.APPROVED })
          .andWhere("e.date_of_reporting BETWEEN :startDate AND :endDate", dateFilter)
          .andWhere("category.scope IS NOT NULL") // Exclude null-scope categories
          .getRawOne();

        // Get production
        const productionResult = await repo
          .createQueryBuilder("pd")
          .select("SUM(pd.quantity)", "totalProduction")
          .where("pd.site_id = :siteId", { siteId })
          .andWhere("pd.start_date <= :endDate AND pd.end_date >= :startDate", dateFilter)
          .getRawOne();

        const emissions = parseFloat(emissionsResult?.totalEmissions || 0);
        const production = parseFloat(productionResult?.totalProduction || 0);

        return {
          siteId,
          totalEmissions: emissions,
          totalProduction: production,
          emissionIntensity: production > 0 ? emissions / production : 0,
        };
      })
    );

    return res.status(200).json({
      comparison: results,
      dateRange: dateFilter,
    });
  } catch (error) {
    console.error("Emission intensity comparison error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get all production data for manager (with filters)
export const getProductionDataForManager = async (req: Request, res: Response) => {
  try {
    const { siteId, startDate, endDate, status, productId } = req.query;

    const queryBuilder = repo
      .createQueryBuilder("pd")
      .leftJoinAndSelect("pd.product", "product")
      .leftJoinAndSelect("pd.site", "site")
      .leftJoinAndSelect("pd.created_by", "created_by")
      .leftJoinAndSelect("pd.reviewed_by", "reviewed_by");

    if (siteId) {
      queryBuilder.andWhere("pd.site_id = :siteId", { siteId: parseInt(siteId as string) });
    }

    if (status) {
      queryBuilder.andWhere("pd.status = :status", { status });
    }

    if (productId) {
      queryBuilder.andWhere("pd.product_id = :productId", {
        productId: parseInt(productId as string),
      });
    }

    if (startDate && endDate) {
      queryBuilder.andWhere(
        "(pd.start_date <= :endDate AND pd.end_date >= :startDate)",
        {
          startDate: new Date(startDate as string),
          endDate: new Date(endDate as string),
        }
      );
    }

    const data = await queryBuilder.orderBy("pd.created_at", "DESC").getMany();

    return res.status(200).json(data);
  } catch (error) {
    console.error("Fetch production data for manager error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Approve production data
export const approveProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;

    const data = await repo.findOne({
      where: { production_id: parseInt(id) },
      relations: ["product", "site"],
    });

    if (!data) {
      return res.status(404).json({ message: "Production data not found" });
    }

    data.status = ProductionDataStatus.APPROVED;
    data.reviewed_by = { user_id: userId } as any;
    data.reviewed_at = new Date();
    data.review_comment = null as any;

    await repo.save(data);

    const updated = await repo.findOne({
      where: { production_id: data.production_id },
      relations: ["product", "site", "created_by", "reviewed_by"],
    });

    return res.status(200).json({
      message: "Production data approved successfully",
      productionData: updated,
    });
  } catch (error) {
    console.error("Approve production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Reject production data
export const rejectProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { comment } = req.body;
    const userId = req.user?.userId;

    const data = await repo.findOne({
      where: { production_id: parseInt(id) },
      relations: ["product", "site"],
    });

    if (!data) {
      return res.status(404).json({ message: "Production data not found" });
    }

    data.status = ProductionDataStatus.REJECTED;
    data.reviewed_by = { user_id: userId } as any;
    data.reviewed_at = new Date();
    data.review_comment = comment || null;

    await repo.save(data);

    const updated = await repo.findOne({
      where: { production_id: data.production_id },
      relations: ["product", "site", "created_by", "reviewed_by"],
    });

    return res.status(200).json({
      message: "Production data rejected",
      productionData: updated,
    });
  } catch (error) {
    console.error("Reject production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Bulk approve production data
export const bulkApproveProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body;
    const userId = req.user?.userId;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array is required" });
    }

    await repo.update(
      { production_id: In(ids) },
      {
        status: ProductionDataStatus.APPROVED,
        reviewed_by: { user_id: userId } as any,
        reviewed_at: new Date(),
        review_comment: null as any,
      }
    );

    return res.status(200).json({
      message: `${ids.length} production data entries approved successfully`,
    });
  } catch (error) {
    console.error("Bulk approve production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Bulk reject production data
export const bulkRejectProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const { ids, comment } = req.body;
    const userId = req.user?.userId;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array is required" });
    }

    await repo.update(
      { production_id: In(ids) },
      {
        status: ProductionDataStatus.REJECTED,
        reviewed_by: { user_id: userId } as any,
        reviewed_at: new Date(),
        review_comment: comment || null,
      }
    );

    return res.status(200).json({
      message: `${ids.length} production data entries rejected`,
    });
  } catch (error) {
    console.error("Bulk reject production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
