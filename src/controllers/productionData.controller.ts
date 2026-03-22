import { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { ProductionData, ProductionDataStatus } from "../entities/ProductionData";
import { Product } from "../entities/Product";
import { Emission, EmissionStatus } from "../entities/Emission";
import { AuditLog } from "../entities/AuditLog";
import { User } from "../entities/User";
import { UserRole } from "../types/type";
import { AuthRequest } from "../middlewares/auth.middleware";
import { sendToQueue } from "../queues/emailProducer";

const repo = AppDataSource.getRepository(ProductionData);
const productRepo = AppDataSource.getRepository(Product);
const emissionRepo = AppDataSource.getRepository(Emission);

// Create production data entry
export const createProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const { product_id, site_id, quantity, unit, start_date, end_date, notes } = req.body;
    const userId = req.user?.userId;
    console.log(`[ProductionData] CREATE by user ${userId} — product: ${product_id}, site: ${site_id}`);

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

// Bulk create production data entries
export const bulkCreateProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const { entries } = req.body;
    const userId = req.user?.userId;
    console.log(`[ProductionData] BULK CREATE by user ${userId} — ${entries?.length || 0} entries`);

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: "entries array is required and must not be empty" });
    }

    const errors: { row: number; message: string }[] = [];
    const toSave: ProductionData[] = [];

    for (let i = 0; i < entries.length; i++) {
      const { product_id, site_id, quantity, unit, start_date, end_date, notes } = entries[i];

      if (!product_id || !site_id || !quantity || !unit || !start_date || !end_date) {
        errors.push({ row: i + 1, message: "Missing required fields (product_id, site_id, quantity, unit, start_date, end_date)" });
        continue;
      }

      if (new Date(start_date) > new Date(end_date)) {
        errors.push({ row: i + 1, message: "start_date cannot be after end_date" });
        continue;
      }

      const product = await productRepo.findOne({
        where: { product_id, site: { site_id } },
      });

      if (!product) {
        errors.push({ row: i + 1, message: "Product not found or does not belong to this site" });
        continue;
      }

      const entry = repo.create({
        product: { product_id },
        site: { site_id },
        quantity: parseFloat(quantity),
        unit: unit.trim(),
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        notes: notes?.trim() || null,
        created_by: userId ? { user_id: userId } : (null as any),
      });

      toSave.push(entry);
    }

    if (toSave.length > 0) {
      await repo.save(toSave);
    }

    return res.status(201).json({
      message: `${toSave.length} production data entries created successfully`,
      created: toSave.length,
      errors,
    });
  } catch (error) {
    console.error("Bulk create production data error:", error);
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

    // Block edits on approved entries (users must not edit approved data)
    if (data.status === ProductionDataStatus.APPROVED) {
      return res.status(403).json({ message: "Cannot edit approved production data" });
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

    // Reset rejected entries to pending so manager can re-review
    if (data.status === ProductionDataStatus.REJECTED) {
      data.status = ProductionDataStatus.PENDING;
      data.reviewed_by = null as any;
      data.review_comment = null as any;
      data.reviewed_at = null as any;
    }

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

    // Block deletes on approved entries
    if (data.status === ProductionDataStatus.APPROVED) {
      return res.status(403).json({ message: "Cannot delete approved production data" });
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

    // Get total production for the site (where production period overlaps with filter, approved only)
    const productionQuery = repo
      .createQueryBuilder("pd")
      .select("SUM(pd.quantity)", "totalProduction")
      .addSelect("pd.unit", "unit")
      .where("pd.site_id = :siteId", { siteId: parseInt(siteId) })
      .andWhere("pd.status = :prodStatus", { prodStatus: ProductionDataStatus.APPROVED })
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

  // For monthly breakdown, use start_date as the reference month (approved production only)
  let productionQuery = repo
    .createQueryBuilder("pd")
    .select("DATE_TRUNC('month', pd.start_date)", "month")
    .addSelect("SUM(pd.quantity)", "production")
    .where("pd.site_id = :siteId", { siteId })
    .andWhere("pd.status = :prodStatus", { prodStatus: ProductionDataStatus.APPROVED })
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

        // Get production (approved only)
        const productionResult = await repo
          .createQueryBuilder("pd")
          .select("SUM(pd.quantity)", "totalProduction")
          .where("pd.site_id = :siteId", { siteId })
          .andWhere("pd.status = :prodStatus", { prodStatus: ProductionDataStatus.APPROVED })
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

    if (data.status !== ProductionDataStatus.PENDING) {
      return res.status(400).json({ message: `Production data is already ${data.status}` });
    }

    console.log(`[ProductionData] APPROVE id=${id} by manager ${userId}`);

    data.status = ProductionDataStatus.APPROVED;
    data.reviewed_by = { user_id: userId } as any;
    data.reviewed_at = new Date();
    data.review_comment = null as any;

    await repo.save(data);

    const updated = await repo.findOne({
      where: { production_id: data.production_id },
      relations: ["product", "site", "created_by", "reviewed_by"],
    });

    // Fetch manager details
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const creator = updated?.created_by;
    const actionInfo = {
      submitterName: `${creator?.name || ""} ${creator?.last_name || ""}`.trim() || "User",
      submitterEmail: creator?.email || "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
    };

    if (creator?.email) {
      console.log(`[ProductionData] Sending approval email to ${creator.email}`);
      await sendToQueue({
        type: "PRODUCTION_APPROVED",
        email: creator.email,
        name: `${creator?.name || ""} ${creator?.last_name || ""}`.trim() || "User",
        retryCount: 0,
        productName: (updated?.product as any)?.name || "N/A",
        siteName: (updated?.site as any)?.name || "",
        ...actionInfo,
      });
    }

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

    if (!comment || !comment.trim()) {
      return res.status(400).json({ message: "Comment is required when rejecting production data" });
    }

    const data = await repo.findOne({
      where: { production_id: parseInt(id) },
      relations: ["product", "site"],
    });

    if (!data) {
      return res.status(404).json({ message: "Production data not found" });
    }

    if (data.status !== ProductionDataStatus.PENDING) {
      return res.status(400).json({ message: `Production data is already ${data.status}` });
    }

    console.log(`[ProductionData] REJECT id=${id} by manager ${userId}`);

    data.status = ProductionDataStatus.REJECTED;
    data.reviewed_by = { user_id: userId } as any;
    data.reviewed_at = new Date();
    data.review_comment = comment.trim();

    await repo.save(data);

    const updated = await repo.findOne({
      where: { production_id: data.production_id },
      relations: ["product", "site", "created_by", "reviewed_by"],
    });

    // Fetch manager details
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const creator = updated?.created_by;
    const actionInfo = {
      submitterName: `${creator?.name || ""} ${creator?.last_name || ""}`.trim() || "User",
      submitterEmail: creator?.email || "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
    };

    if (creator?.email) {
      await sendToQueue({
        type: "PRODUCTION_REJECTED",
        email: creator.email,
        name: `${creator?.name || ""} ${creator?.last_name || ""}`.trim() || "User",
        retryCount: 0,
        productName: (updated?.product as any)?.name || "N/A",
        siteName: (updated?.site as any)?.name || "",
        comment: updated?.review_comment || "",
        ...actionInfo,
      });
    }

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

    console.log(`[ProductionData] BULK APPROVE ${ids.length} ids by manager ${userId}`);

    const dataToApprove = await repo.find({
      where: {
        production_id: In(ids),
        status: ProductionDataStatus.PENDING,
      },
      relations: ["created_by", "product", "site"],
    });

    if (dataToApprove.length === 0) {
      return res.status(400).json({ message: "No pending production data found to approve" });
    }

    const eligibleIds = dataToApprove.map((d) => d.production_id);
    console.log(`[ProductionData] Approving ${eligibleIds.length} of ${ids.length} (rest already processed)`);

    await repo.update(
      { production_id: In(eligibleIds) },
      {
        status: ProductionDataStatus.APPROVED,
        reviewed_by: { user_id: userId } as any,
        reviewed_at: new Date(),
        review_comment: null as any,
      }
    );

    // Fetch manager details
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const totalCount = dataToApprove.length;
    const productSummary: Record<string, number> = {};
    const creatorNames: string[] = [];
    for (const item of dataToApprove) {
      const productName = (item.product as any)?.name || "N/A";
      productSummary[productName] = (productSummary[productName] || 0) + 1;
      const creator = item.created_by;
      if (creator?.name) {
        const fullName = `${creator.name || ""} ${creator.last_name || ""}`.trim();
        if (!creatorNames.includes(fullName)) creatorNames.push(fullName);
      }
    }
    const products = Object.entries(productSummary).map(([categoryName, count]) => ({ categoryName, count }));

    const actionInfo = {
      submitterName: creatorNames.join(", ") || "User",
      submitterEmail: "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
    };

    const creatorMap = new Map<number, User>();
    for (const item of dataToApprove) {
      const creator = item.created_by;
      if (creator?.email && !creatorMap.has(creator.user_id)) {
        creatorMap.set(creator.user_id, creator);
      }
    }

    for (const creator of creatorMap.values()) {
      await sendToQueue({
        type: "BULK_PRODUCTION_APPROVED",
        email: creator.email,
        name: `${creator.name || ""} ${creator.last_name || ""}`.trim() || "User",
        retryCount: 0,
        totalCount,
        products,
        ...actionInfo,
      });
    }

    return res.status(200).json({
      message: `${eligibleIds.length} production data entries approved successfully`,
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

    if (!comment || !comment.trim()) {
      return res.status(400).json({ message: "Comment is required when rejecting production data" });
    }

    console.log(`[ProductionData] BULK REJECT ${ids.length} ids by manager ${userId}`);

    const dataToReject = await repo.find({
      where: {
        production_id: In(ids),
        status: ProductionDataStatus.PENDING,
      },
      relations: ["created_by", "product", "site"],
    });

    if (dataToReject.length === 0) {
      return res.status(400).json({ message: "No pending production data found to reject" });
    }

    const eligibleIds = dataToReject.map((d) => d.production_id);
    console.log(`[ProductionData] Rejecting ${eligibleIds.length} of ${ids.length} (rest already processed)`);

    await repo.update(
      { production_id: In(eligibleIds) },
      {
        status: ProductionDataStatus.REJECTED,
        reviewed_by: { user_id: userId } as any,
        reviewed_at: new Date(),
        review_comment: comment.trim(),
      }
    );

    // Fetch manager details
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const totalCount = dataToReject.length;
    const productSummary: Record<string, number> = {};
    const creatorNames: string[] = [];
    for (const item of dataToReject) {
      const productName = (item.product as any)?.name || "N/A";
      productSummary[productName] = (productSummary[productName] || 0) + 1;
      const creator = item.created_by;
      if (creator?.name) {
        const fullName = `${creator.name || ""} ${creator.last_name || ""}`.trim();
        if (!creatorNames.includes(fullName)) creatorNames.push(fullName);
      }
    }
    const products = Object.entries(productSummary).map(([categoryName, count]) => ({ categoryName, count }));

    const actionInfo = {
      submitterName: creatorNames.join(", ") || "User",
      submitterEmail: "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
    };

    const creatorMap = new Map<number, User>();
    for (const item of dataToReject) {
      const creator = item.created_by;
      if (creator?.email && !creatorMap.has(creator.user_id)) {
        creatorMap.set(creator.user_id, creator);
      }
    }

    for (const creator of creatorMap.values()) {
      await sendToQueue({
        type: "BULK_PRODUCTION_REJECTED",
        email: creator.email,
        name: `${creator.name || ""} ${creator.last_name || ""}`.trim() || "User",
        retryCount: 0,
        totalCount,
        products,
        comment,
        ...actionInfo,
      });
    }

    return res.status(200).json({
      message: `${eligibleIds.length} production data entries rejected`,
    });
  } catch (error) {
    console.error("Bulk reject production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Manager edit production data (with audit trail, allows editing approved entries)
export const managerUpdateProductionData = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    const { quantity, unit, start_date, end_date, notes } = req.body;

    // Verify the user is a manager
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { user_id: userId } });
    if (!user || user.role !== UserRole.MANAGER) {
      return res.status(403).json({ message: "Only managers can use this endpoint" });
    }

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
      return res.status(400).json({ message: "start_date cannot be after end_date" });
    }

    // Capture changes for audit trail
    const changedFields: Record<string, { old: any; new: any }> = {};
    if (quantity !== undefined && parseFloat(quantity) !== Number(data.quantity)) {
      changedFields.quantity = { old: data.quantity, new: parseFloat(quantity) };
    }
    if (unit && unit.trim() !== data.unit) {
      changedFields.unit = { old: data.unit, new: unit.trim() };
    }
    if (start_date && new Date(start_date).toISOString() !== new Date(data.start_date).toISOString()) {
      changedFields.start_date = { old: data.start_date, new: start_date };
    }
    if (end_date && new Date(end_date).toISOString() !== new Date(data.end_date).toISOString()) {
      changedFields.end_date = { old: data.end_date, new: end_date };
    }
    if (notes !== undefined && (notes?.trim() || null) !== (data.notes || null)) {
      changedFields.notes = { old: data.notes, new: notes?.trim() || null };
    }

    // Only proceed if there are actual changes
    if (Object.keys(changedFields).length === 0) {
      return res.status(200).json({ message: "No changes detected", productionData: data });
    }

    // Apply changes
    if (quantity !== undefined) data.quantity = parseFloat(quantity);
    if (unit) data.unit = unit.trim();
    if (start_date) data.start_date = new Date(start_date);
    if (end_date) data.end_date = new Date(end_date);
    if (notes !== undefined) data.notes = notes?.trim() || null;

    await repo.save(data);

    // Write audit log
    const auditRepo = AppDataSource.getRepository(AuditLog);
    const auditEntry = auditRepo.create({
      entity_type: "production_data",
      entity_id: data.production_id,
      action: "manager_edit",
      changed_fields: changedFields,
      changed_by: { user_id: userId } as any,
    });
    await auditRepo.save(auditEntry);

    const updated = await repo.findOne({
      where: { production_id: data.production_id },
      relations: ["product", "site", "created_by"],
    });

    return res.status(200).json({
      message: "Production data updated by manager",
      productionData: updated,
    });
  } catch (error) {
    console.error("Manager update production data error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
