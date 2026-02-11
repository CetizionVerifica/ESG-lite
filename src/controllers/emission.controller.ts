import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";
import { EmissionFactor } from "../entities/EmissionFactor";
import { AuthRequest } from "../middlewares/auth.middleware";
import { In } from "typeorm";
import { ProductionData, ProductionDataStatus } from "../entities/ProductionData";

const repo = AppDataSource.getRepository(Emission);
const emissionFactorRepo = AppDataSource.getRepository(EmissionFactor);

// Common unit conversions
const unitConversions: Record<string, Record<string, number>> = {
  // Volume
  litre: { gallon: 0.264172, ml: 1000, "cubic meter": 0.001, "kilo litre": 0.001, kl: 0.001 },
  kl: { litre: 1000, gallon: 264.172, ml: 1000000, "cubic meter": 1 },
  "kilo litre": { litre: 1000, gallon: 264.172, ml: 1000000, "cubic meter": 1 },
  gallon: { litre: 3.78541, ml: 3785.41, "cubic meter": 0.00378541, kl: 0.00378541 },
  ml: { litre: 0.001, gallon: 0.000264172, kl: 0.000001 },
  "cubic meter": { litre: 1000, gallon: 264.172, kl: 1 },
  // Weight
  kg: { lb: 2.20462, tonne: 0.001, g: 1000 },
  lb: { kg: 0.453592, tonne: 0.000453592, g: 453.592 },
  tonne: { kg: 1000, lb: 2204.62, g: 1000000 },
  g: { kg: 0.001, lb: 0.00220462 },
  // Energy
  kwh: { mwh: 0.001, gj: 0.0036, mj: 3.6 },
  mwh: { kwh: 1000, gj: 3.6, mj: 3600 },
  gj: { kwh: 277.778, mwh: 0.277778, mj: 1000 },
  mj: { kwh: 0.277778, gj: 0.001 },
  // Currency
  inr: { usd: 0.012 },
  usd: { inr: 83.5 },
};

// Get conversion factor between two units
const getConversionFactor = (fromUnit: string, toUnit: string): number | null => {
  const from = fromUnit?.toLowerCase().trim();
  const to = toUnit?.toLowerCase().trim();
  return unitConversions[from]?.[to] || null;
};

// Check if units match (handles null/undefined like frontend)
const unitsMatchExact = (unit1: string | null | undefined, unit2: string | null | undefined): boolean => {
  if (!unit1 || !unit2) return true; // Treat null/undefined as match (like frontend)
  return unit1.toLowerCase().trim() === unit2.toLowerCase().trim();
};

// Get emissions by site, category, and date
export const getEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { siteId, categoryId, date } = req.query;

    const whereClause: any = {};

    if (siteId) {
      whereClause.site = { site_id: parseInt(siteId as string) };
    }

    if (categoryId) {
      whereClause.category = { category_id: parseInt(categoryId as string) };
    }

    if (date) {
      // Date format: YYYY-MM (e.g., 2024-01)
      const [year, month] = (date as string).split("-");
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0);

      whereClause.date_of_reporting = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    const emissions = await repo.find({
      where: whereClause,
      relations: ["site", "category", "reviewed_by", "created_by"],
      order: { pk_id: "DESC" },
    });

    return res.status(200).json(emissions);
  } catch (error) {
    console.error("Fetch emissions error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get emissions by site and category with date filter
export const getEmissionsBySiteAndCategory = async (req: Request, res: Response) => {
  try {
    const { siteId, categoryId }: any = req.params;
    const { date }: any = req.query;

    const queryBuilder = repo
      .createQueryBuilder("emission")
      .leftJoinAndSelect("emission.site", "site")
      .leftJoinAndSelect("emission.category", "category")
      .leftJoinAndSelect("emission.reviewed_by", "reviewed_by")
      .leftJoinAndSelect("emission.created_by", "created_by")
      .where("site.site_id = :siteId", { siteId: parseInt(siteId) })
      .andWhere("category.category_id = :categoryId", { categoryId: parseInt(categoryId) });

    if (date) {
      // Date format: YYYY-MM (e.g., 2024-01)
      const [year, month] = (date as string).split("-");
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0);

      queryBuilder.andWhere("emission.date_of_reporting >= :startDate", { startDate });
      queryBuilder.andWhere("emission.date_of_reporting <= :endDate", { endDate });
    }

    const emissions = await queryBuilder.orderBy("emission.pk_id", "DESC").getMany();

    return res.status(200).json(emissions);
  } catch (error) {
    console.error("Fetch emissions by site and category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Create a new emission entry
export const createEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { site_id, category_id, activity_data, total_emission, unit, date_of_reporting, activity_data_unit } = req.body;
    const userId = req.user?.userId;

    if (!site_id || !category_id || !activity_data || !date_of_reporting) {
      return res.status(400).json({
        message: "site_id, category_id, activity_data, and date_of_reporting are required",
      });
    }

    let calculatedEmission = total_emission || 0;

    // Calculate total emission if emission_category is provided in activity_data
    if (activity_data.emission_category && activity_data_unit) {
      // Calculate target year for emission factor (reporting year - 1, matching frontend logic)
      // Use string parsing to avoid timezone issues (frontend does: parseInt(selectedDate.substring(0, 4)) - 1)
      const reportingYearStr = typeof date_of_reporting === 'string'
        ? date_of_reporting.substring(0, 4)
        : new Date(date_of_reporting).getFullYear().toString();
      const targetYear = parseInt(reportingYearStr) - 1;

      // Find the emission factor for the selected emission category and year
      let emissionFactor = await emissionFactorRepo.findOne({
        where: {
          site: { site_id },
          category: { category_id },
          emission_category_name: activity_data.emission_category,
          year: targetYear,
        },
      });

      // Fallback: if no factor found for target year, try without year filter
      if (!emissionFactor) {
        emissionFactor = await emissionFactorRepo.findOne({
          where: {
            site: { site_id },
            category: { category_id },
            emission_category_name: activity_data.emission_category,
          },
        });
      }

      if (emissionFactor) {
        // Try to find the numeric value from activity_data
        let activityValue = 0;

        // Known dropdown/select column names to skip (these contain IDs, not activity data)
        const skipColumns = new Set(['material', 'disposal_method', 'fuel_type', 'vehicle_type', 'source_type', 'waste_type', 'transport_mode']);

        // Check common field names first (case-insensitive)
        const commonFields = ['activity_value', 'quantity', 'value', 'amount', 'consumption', 'activity data', 'activity_data'];
        for (const field of commonFields) {
          // Case-insensitive search
          const matchingKey = Object.keys(activity_data).find(k => k.toLowerCase() === field.toLowerCase());
          if (matchingKey && activity_data[matchingKey] !== undefined && activity_data[matchingKey] !== '') {
            activityValue = parseFloat(activity_data[matchingKey]);
            if (!isNaN(activityValue) && activityValue > 0) {
              break;
            }
          }
        }

        // If not found in common fields, look for any numeric value
        // Skip: emission_category, known dropdown columns, and small values that look like IDs
        if (activityValue === 0) {
          for (const [key, value] of Object.entries(activity_data)) {
            const keyLower = key.toLowerCase();
            // Skip emission_category and known dropdown columns
            if (key === 'emission_category' || skipColumns.has(keyLower)) {
              continue;
            }
            if (value !== undefined && value !== '') {
              const numValue = parseFloat(value as string);
              // Skip small integers (1-99) as they're likely dropdown IDs, not activity data
              // Real activity data is typically larger (e.g., 10000 kg, 5000 kWh)
              if (!isNaN(numValue) && numValue >= 100) {
                activityValue = numValue;
                break;
              }
            }
          }
        }

        // Fallback: if still not found, accept any positive number (in case activity data is small)
        if (activityValue === 0) {
          for (const [key, value] of Object.entries(activity_data)) {
            const keyLower = key.toLowerCase();
            if (key === 'emission_category' || skipColumns.has(keyLower)) {
              continue;
            }
            if (value !== undefined && value !== '') {
              const numValue = parseFloat(value as string);
              if (!isNaN(numValue) && numValue > 0) {
                activityValue = numValue;
                break;
              }
            }
          }
        }

        if (activityValue > 0) {
          // Check if units match (handles null/undefined like frontend)
          const unitsMatch = unitsMatchExact(emissionFactor.denominator_unit, activity_data_unit);

          if (unitsMatch) {
            // Units match - calculate directly
            calculatedEmission = Math.round((activityValue * emissionFactor.factor_value) / 1000 * 100) / 100;
          } else {
            // Units don't match - try to convert
            const conversionFactor = getConversionFactor(activity_data_unit, emissionFactor.denominator_unit);

            if (conversionFactor) {
              // Apply conversion and calculate
              const convertedValue = activityValue * conversionFactor;
              calculatedEmission = Math.round((convertedValue * emissionFactor.factor_value) / 1000 * 100) / 100;
            } else {
              // No conversion available - reject
              return res.status(400).json({
                message: `Unit mismatch: Expected "${emissionFactor.denominator_unit}" but received "${activity_data_unit}". No conversion available.`,
                expected_unit: emissionFactor.denominator_unit,
                received_unit: activity_data_unit,
              });
            }
          }
        }
      } else {
        return res.status(400).json({
          message: `No emission factor found for emission category "${activity_data.emission_category}" (year ${targetYear})`,
        });
      }
    }

    const emission = repo.create({
      site: { site_id },
      category: { category_id },
      activity_data,
      total_emission: calculatedEmission,
      unit: "tCO2e",
      date_of_reporting: new Date(date_of_reporting),
      activity_data_unit: activity_data_unit || null,
      created_by: userId ? { user_id: userId } as any : null,
    });

    await repo.save(emission);

    const savedEmission = await repo.findOne({
      where: { pk_id: emission.pk_id },
      relations: ["site", "category", "created_by"],
    });

    return res.status(201).json({
      message: "Emission created successfully",
      emission: savedEmission,
    });
  } catch (error) {
    console.error("Create emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Update an emission entry
export const updateEmission = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { activity_data, date_of_reporting } = req.body;

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emission) {
      return res.status(404).json({
        message: "Emission not found",
      });
    }

    if (activity_data !== undefined) {
      emission.activity_data = activity_data;

      // Reset status to pending when user edits the emission
      emission.status = EmissionStatus.PENDING;
      emission.reviewed_by = null as any;
      emission.review_comment = null as any;
      emission.reviewed_at = null as any;

      // Recalculate total emission if activity_data has emission_category
      if (activity_data.emission_category && emission.activity_data_unit) {
        // Calculate target year for emission factor (reporting year - 1, matching frontend logic)
        // const targetYear = emission.date_of_reporting.getFullYear() - 1;

        const reportingDate = emission.date_of_reporting instanceof Date 
  ? emission.date_of_reporting 
  : new Date(emission.date_of_reporting);

const targetYear = reportingDate.getFullYear() - 1;

        // Find the emission factor for the selected emission category and year
        let emissionFactor = await emissionFactorRepo.findOne({
          where: {
            site: { site_id: emission.site.site_id },
            category: { category_id: emission.category.category_id },
            emission_category_name: activity_data.emission_category,
            year: targetYear,
          },
        });

        // Fallback: if no factor found for target year, try without year filter
        if (!emissionFactor) {
          emissionFactor = await emissionFactorRepo.findOne({
            where: {
              site: { site_id: emission.site.site_id },
              category: { category_id: emission.category.category_id },
              emission_category_name: activity_data.emission_category,
            },
          });
        }

        if (emissionFactor) {
          // Find activity value from activity_data
          let activityValue = 0;

          // Known dropdown/select column names to skip (these contain IDs, not activity data)
          const skipColumns = new Set(['material', 'disposal_method', 'fuel_type', 'vehicle_type', 'source_type', 'waste_type', 'transport_mode']);

          // Check common field names first (case-insensitive)
          const commonFields = ['activity_value', 'quantity', 'value', 'amount', 'consumption', 'activity data', 'activity_data'];
          for (const field of commonFields) {
            const matchingKey = Object.keys(activity_data).find(k => k.toLowerCase() === field.toLowerCase());
            if (matchingKey && activity_data[matchingKey] !== undefined && activity_data[matchingKey] !== '') {
              activityValue = parseFloat(activity_data[matchingKey]);
              if (!isNaN(activityValue) && activityValue > 0) break;
            }
          }

          // If not found in common fields, look for any numeric value >= 100 (skip likely dropdown IDs)
          if (activityValue === 0) {
            for (const [key, value] of Object.entries(activity_data)) {
              const keyLower = key.toLowerCase();
              if (key === 'emission_category' || skipColumns.has(keyLower)) continue;
              if (value !== undefined && value !== '') {
                const numValue = parseFloat(value as string);
                if (!isNaN(numValue) && numValue >= 100) {
                  activityValue = numValue;
                  break;
                }
              }
            }
          }

          // Fallback: accept any positive number
          if (activityValue === 0) {
            for (const [key, value] of Object.entries(activity_data)) {
              const keyLower = key.toLowerCase();
              if (key === 'emission_category' || skipColumns.has(keyLower)) continue;
              if (value !== undefined && value !== '') {
                const numValue = parseFloat(value as string);
                if (!isNaN(numValue) && numValue > 0) {
                  activityValue = numValue;
                  break;
                }
              }
            }
          }

          if (activityValue > 0) {
            // Check if units match (handles null/undefined like frontend)
            const unitsMatch = unitsMatchExact(emissionFactor.denominator_unit, emission.activity_data_unit);

            if (unitsMatch) {
              emission.total_emission = Math.round((activityValue * emissionFactor.factor_value) / 1000 * 100) / 100;
            } else {
              const conversionFactor = getConversionFactor(emission.activity_data_unit, emissionFactor.denominator_unit);
              if (conversionFactor) {
                const convertedValue = activityValue * conversionFactor;
                emission.total_emission = Math.round((convertedValue * emissionFactor.factor_value) / 1000 * 100) / 100;
              }
            }
          }
        }
      }
    }

    if (date_of_reporting !== undefined) emission.date_of_reporting = new Date(date_of_reporting);

    await repo.save(emission);

    return res.status(200).json({
      message: "Emission updated successfully",
      emission,
    });
  } catch (error) {
    console.error("Update emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Delete an emission entry
export const deleteEmission = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
    });

    if (!emission) {
      return res.status(404).json({
        message: "Emission not found",
      });
    }

    await repo.delete({ pk_id: parseInt(id) });

    return res.status(200).json({
      message: "Emission deleted successfully",
    });
  } catch (error) {
    console.error("Delete emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk delete emissions
export const bulkDeleteEmissions = async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ids array is required",
      });
    }

    const result = await repo.delete(ids);

    return res.status(200).json({
      message: `Successfully deleted ${result.affected} emission(s)`,
      deleted: result.affected,
    });
  } catch (error) {
    console.error("Bulk delete emissions error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get emissions pending approval (for managers)
export const getPendingEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { siteId, categoryId } = req.query;

    const whereClause: any = {
      status: EmissionStatus.PENDING,
    };

    if (siteId) {
      whereClause.site = { site_id: parseInt(siteId as string) };
    }

    if (categoryId) {
      whereClause.category = { category_id: parseInt(categoryId as string) };
    }

    const emissions = await repo.find({
      where: whereClause,
      relations: ["site", "category", "reviewed_by", "created_by"],
      order: { created_at: "DESC" },
    });

    return res.status(200).json(emissions);
  } catch (error) {
    console.error("Fetch pending emissions error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Approve an emission entry
export const approveEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;
    const { comment } = req.body;
    const userId = req.user?.userId;

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emission) {
      return res.status(404).json({
        message: "Emission not found",
      });
    }

    if (emission.status !== EmissionStatus.PENDING) {
      return res.status(400).json({
        message: `Emission is already ${emission.status}`,
      });
    }

    emission.status = EmissionStatus.APPROVED;
    emission.review_comment = comment || null;
    emission.reviewed_by = { user_id: userId } as any;
    emission.reviewed_at = new Date();

    await repo.save(emission);

    const updatedEmission = await repo.findOne({
      where: { pk_id: emission.pk_id },
      relations: ["site", "category", "reviewed_by", "created_by"],
    });

    return res.status(200).json({
      message: "Emission approved successfully",
      emission: updatedEmission,
    });
  } catch (error) {
    console.error("Approve emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Reject an emission entry
export const rejectEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;
    const { comment } = req.body;
    const userId = req.user?.userId;

    if (!comment) {
      return res.status(400).json({
        message: "Comment is required when rejecting an emission",
      });
    }

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emission) {
      return res.status(404).json({
        message: "Emission not found",
      });
    }

    if (emission.status !== EmissionStatus.PENDING) {
      return res.status(400).json({
        message: `Emission is already ${emission.status}`,
      });
    }

    emission.status = EmissionStatus.REJECTED;
    emission.review_comment = comment;
    emission.reviewed_by = { user_id: userId } as any;
    emission.reviewed_at = new Date();

    await repo.save(emission);

    const updatedEmission = await repo.findOne({
      where: { pk_id: emission.pk_id },
      relations: ["site", "category", "reviewed_by", "created_by"],
    });

    return res.status(200).json({
      message: "Emission rejected",
      emission: updatedEmission,
    });
  } catch (error) {
    console.error("Reject emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk approve emissions
export const bulkApproveEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { ids, comment } = req.body;
    const userId = req.user?.userId;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ids array is required",
      });
    }

    await repo.update(
      { pk_id: In(ids), status: EmissionStatus.PENDING },
      {
        status: EmissionStatus.APPROVED,
        review_comment: comment || null,
        reviewed_by: { user_id: userId } as any,
        reviewed_at: new Date(),
      }
    );

    return res.status(200).json({
      message: `${ids.length} emissions approved successfully`,
    });
  } catch (error) {
    console.error("Bulk approve emissions error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk reject emissions
export const bulkRejectEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { ids, comment } = req.body;
    const userId = req.user?.userId;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ids array is required",
      });
    }

    if (!comment) {
      return res.status(400).json({
        message: "Comment is required when rejecting emissions",
      });
    }

    await repo.update(
      { pk_id: In(ids), status: EmissionStatus.PENDING },
      {
        status: EmissionStatus.REJECTED,
        review_comment: comment,
        reviewed_by: { user_id: userId } as any,
        reviewed_at: new Date(),
      }
    );

    return res.status(200).json({
      message: `${ids.length} emissions rejected`,
    });
  } catch (error) {
    console.error("Bulk reject emissions error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getApprovedEmissionsReport = async (req: Request, res: Response) => {
   try {
    const { siteIds, categoryIds, frequency, year, month } = req.body as {
      siteIds: number[];
      categoryIds?: number[];
      frequency: "yearly" | "monthly";
      year: number;
      month?: number;
    };

    if (!siteIds?.length || !year || !frequency) {
      return res.status(400).json({ message: "siteIds, frequency and year are required" });
    }

     let startDate: Date;
    let endDate: Date;

     if (frequency === "monthly") {
      if (!month) {
        return res.status(400).json({ message: "month is required for monthly frequency" });
      }
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0);
    } else {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31);
    }

    const repo = AppDataSource.getRepository(Emission);

    const baseQuery = repo
      .createQueryBuilder("emission")
      .leftJoin("emission.category", "category")
      .leftJoin("emission.site", "site")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate });

    if (categoryIds?.length) {
      baseQuery.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
    }
     const totalsRaw = await baseQuery.clone().select([
      `SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END) AS "scope1"`,
      `SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END) AS "scope2"`,
      `SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END) AS "scope3"`,
    ]).getRawOne();

    const scope1 = Number(totalsRaw.scope1) || 0;
    const scope2 = Number(totalsRaw.scope2) || 0;
    const scope3 = Number(totalsRaw.scope3) || 0;
    const total = scope1 + scope2 + scope3;
    
   const bySiteRaw = await baseQuery
      .clone()
      .select([
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
      ])
      .groupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy("site.name", "ASC")
      .getRawMany();

    const bySite = bySiteRaw.map((r) => {
      const s1 = Number(r.scope1) || 0;
      const s2 = Number(r.scope2) || 0;
      const s3 = Number(r.scope3) || 0;
      const siteTotal = s1 + s2 + s3;

      return {
        siteId: Number(r.siteId),
        siteName: String(r.siteName),
        scope1: s1,
        scope2: s2,
        scope3: s3,
        total: siteTotal,
        pctOfTotal: total ? Number(((siteTotal / total) * 100).toFixed(2)) : 0,
      };
    });

    const monthlyRaw = await baseQuery
      .clone()
      .select([
        `to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM') AS "month"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
      ])
      .groupBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`)
      .orderBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`, "ASC")
      .getRawMany();

    const monthly = monthlyRaw.map((m) => {
      const s1 = Number(m.scope1) || 0;
      const s2 = Number(m.scope2) || 0;
      const s3 = Number(m.scope3) || 0;
      return {
        month: String(m.month),
        scope1: s1,
        scope2: s2,
        scope3: s3,
        total: s1 + s2 + s3,
      };
    });

    return res.status(200).json({
      totals: { scope1, scope2, scope3, total },
      bySite,
      monthly,
    });

  }
  catch (error) {
    console.error("Get approved emissions report error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

type Frequency = "yearly" | "monthly";


export const getEdeReport = async(req:Request, res:Response) =>{
  try {
    const { siteIds, categoryIds, frequency, year, month } = req.body as {
      siteIds: number[];
      categoryIds?: number[];
      frequency: Frequency;
      year: number;
      month?: number;
    };

    if (!siteIds || siteIds.length === 0) {
      return res.status(400).json({ message: "siteIds is required" });
    }
    if (!year || !frequency) {
      return res.status(400).json({ message: "frequency and year are required" });
    }
    if (frequency === "monthly" && (!month || month < 1 || month > 12)) {
      return res.status(400).json({ message: "month (1-12) is required for monthly frequency" });
    }
     let startDate: Date;
    let endDate: Date;

    if (frequency === "monthly") {
      startDate = new Date(year, (month as number) - 1, 1);
      endDate = new Date(year, month as number, 0);
    } else {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31);
    }

    const repo = AppDataSource.getRepository(Emission);

     const base = repo
      .createQueryBuilder("emission")
      .leftJoin("emission.site", "site")
      .leftJoin("emission.category", "category")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate });

      if (categoryIds && categoryIds.length > 0) {
      base.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
    }
    const totalsRaw = await base.clone().select([
      `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
      `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
      `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
    ]).getRawOne();

    const scope1 = Number(totalsRaw.scope1) || 0;
    const scope2 = Number(totalsRaw.scope2) || 0;
    const scope3 = Number(totalsRaw.scope3) || 0;
    const total = scope1 + scope2 + scope3;
    const bySiteRaw = await base.clone()
      .select([
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
      ])
      .groupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy("site.name", "ASC")
      .getRawMany();

    const bySite = bySiteRaw.map((r) => {
      const s1 = Number(r.scope1) || 0;
      const s2 = Number(r.scope2) || 0;
      const s3 = Number(r.scope3) || 0;
      const siteTotal = s1 + s2 + s3;

      return {
        siteId: Number(r.siteId),
        siteName: String(r.siteName),
        scope1: s1,
        scope2: s2,
        scope3: s3,
        total: siteTotal,
        pctOfTotal: total ? Number(((siteTotal / total) * 100).toFixed(2)) : 0,
      };
    });
     const siteDonut = bySite.map((s) => ({
      name: s.siteName,
      value: Number(s.total.toFixed(2)),
      pct: s.pctOfTotal,
    }));
    const monthlyBySiteRaw = await base.clone()
      .select([
        `to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM') AS "month"`,
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(CASE WHEN category.scope IN ('Scope 1','Scope 2','Scope 3') THEN emission.total_emission ELSE 0 END), 0) AS "total"`,
      ])
      .groupBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`)
      .addGroupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`, "ASC")
      .addOrderBy("site.name", "ASC")
      .getRawMany();

       const monthlyBySite = monthlyBySiteRaw.map((m) => ({
      month: String(m.month), 
      siteId: Number(m.siteId),
      siteName: String(m.siteName),
      total: Number(m.total) || 0,
    }));

    const savedBySiteRaw = await base.clone()
      .select([
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(CASE WHEN category.scope IS NULL THEN emission.total_emission ELSE 0 END), 0) AS "saved"`,
      ])
      .groupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy("site.name", "ASC")
      .getRawMany();

    const savedBySite = savedBySiteRaw.map((r) => ({
      siteId: Number(r.siteId),
      siteName: String(r.siteName),
      saved: Number(r.saved) || 0, 
    }));

     const renewableKwhBySiteRaw = await base.clone()
      .select([
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `
          COALESCE(
            SUM(
              CASE WHEN category.scope IS NULL THEN
                COALESCE(
                  NULLIF((emission.activity_data->>'Activity Data')::numeric, NULL),
                  NULLIF((emission.activity_data->>'activity_value')::numeric, NULL),
                  NULLIF((emission.activity_data->>'value')::numeric, NULL),
                  NULLIF((emission.activity_data->>'quantity')::numeric, NULL),
                  0
                )
              ELSE 0 END
            ),
          0) AS "kwh"
        `,
      ])
      .groupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy("site.name", "ASC")
      .getRawMany();

    const renewableKwhBySite = renewableKwhBySiteRaw.map((r) => ({
      siteId: Number(r.siteId),
      siteName: String(r.siteName),
      kwh: Number(r.kwh) || 0,
      unit: "kWh",
    }));

    const intensityEmissionsRaw = await base.clone()
   .select([
    `to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM') AS "month"`,
    `site.site_id AS "siteId"`,
    `site.name AS "siteName"`,
    `
      COALESCE(
        SUM(
          CASE 
            WHEN category.scope IN ('Scope 1','Scope 2','Scope 3')
            THEN emission.total_emission
            ELSE 0
          END
        ),
      0) AS "emissions"
    `,
  ])
  .groupBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`)
  .addGroupBy("site.site_id")
  .addGroupBy("site.name")
  .orderBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`, "ASC")
  .addOrderBy("site.name", "ASC")
  .getRawMany();


  const prodRepo = AppDataSource.getRepository(ProductionData);

const monthlyProductionRaw = await prodRepo
  .createQueryBuilder("pd")
  .leftJoin("pd.site", "site")
  .select([
    `to_char(date_trunc('month', pd.start_date), 'YYYY-MM') AS "month"`,
    `site.site_id AS "siteId"`,
    `site.name AS "siteName"`,
    `COALESCE(SUM(pd.quantity), 0) AS "production"`,
    `MAX(pd.unit) AS "unit"`,
  ])
  .where("pd.status = :status", { status: ProductionDataStatus.APPROVED })
  .andWhere("site.site_id IN (:...siteIds)", { siteIds })
  .andWhere("pd.start_date <= :endDate AND pd.end_date >= :startDate", {
    startDate,
    endDate,
  })
  .groupBy(`to_char(date_trunc('month', pd.start_date), 'YYYY-MM')`)
  .addGroupBy("site.site_id")
  .addGroupBy("site.name")
  .orderBy(`to_char(date_trunc('month', pd.start_date), 'YYYY-MM')`, "ASC")
  .addOrderBy("site.name", "ASC")
  .getRawMany();

  const productionBySiteMonth = new Map<string, { production: number; unit: string }>();


monthlyProductionRaw.forEach((r) => {
  const key = `${Number(r.siteId)}|${String(r.month)}`;
  productionBySiteMonth.set(key, {
    production: Number(r.production) || 0,
    unit: String(r.unit || "unit"),
  });
});
  const intensityMonthly = intensityEmissionsRaw.map((r) => {
  const siteId = Number(r.siteId);
  const siteName = String(r.siteName);
  const month = String(r.month);
  const emissions = Number(r.emissions) || 0;

  const key = `${siteId}|${month}`;
  const prod = productionBySiteMonth.get(key);

  const production = prod?.production || 0;
  const unit = prod?.unit || "unit";

  const intensity =
    production > 0
      ? Number((emissions / production).toFixed(6))
      : 0;

  return {
    siteId,
    siteName,
    month,
    emissions,
    production,
    intensity,
    unit,
  };
});

      return res.status(200).json({
      range: {
        frequency,
        year,
        month: frequency === "monthly" ? month : null,
        startDate,
        endDate,
      },
      totals: { scope1, scope2, scope3, total },

      bySite,      
      siteDonut,    

      monthlyBySite,        
      savedBySite,          
      renewableKwhBySite,   

      intensityMonthly,    
    });

  }
  catch(error)
  {
    console.error("EDE report error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }

}

type YearType = "CY" | "FY";

type GhgReportRequest = {
  siteIds: number[];
  categoryIds?: number[];
  yearType: YearType;
  year: number;
  compareYear?: number;
}

const FY_START_MONTH = 4;

function getDateRange(yearType: YearType, year: number) {
  if (yearType === "CY") {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59, 999);
    return { startDate, endDate };
  }
  const startMonthIndex = FY_START_MONTH - 1;
  const startDate = new Date(year - 1, startMonthIndex, 1);
  const endDate = new Date(year, startMonthIndex, 1);
  endDate.setMilliseconds(endDate.getMilliseconds() - 1); 

  return { startDate, endDate };

}

function pct(n: number, d: number, dp = 2) {
  if (!d) return 0;
  return Number(((n / d) * 100).toFixed(dp));
}
export const getGhgReportTables = async (req: Request, res: Response) => {
  try{

    const {
      siteIds,
      categoryIds,
      yearType,
      year,
      compareYear
    } = req.body as GhgReportRequest;

     if (!siteIds || siteIds.length === 0) {
      return res.status(400).json({ message: "siteIds is required" });
    }
    if (!year || !yearType) {
      return res.status(400).json({ message: "yearType and year are required" });
    }
    if (yearType !== "CY" && yearType !== "FY") {
      return res.status(400).json({ message: "yearType must be CY or FY" });
    }

    const selectedYear = year;
    const compYear = compareYear ?? year - 1;

    const rangeComp = getDateRange(yearType, compYear);
    const rangeSelected = getDateRange(yearType, selectedYear);

    const repo = AppDataSource.getRepository(Emission);

    const baseQB = (range: { startDate: Date; endDate: Date }) => {
      const qb = repo
        .createQueryBuilder("emission")
        .leftJoin("emission.site", "site")
        .leftJoin("emission.category", "category")
        .where("emission.status = :status", { status: EmissionStatus.APPROVED })
        .andWhere("site.site_id IN (:...siteIds)", { siteIds })
        .andWhere("emission.date_of_reporting >= :startDate", { startDate: range.startDate })
        .andWhere("emission.date_of_reporting <= :endDate", { endDate: range.endDate });

      if (categoryIds && categoryIds.length > 0) {
        qb.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
      }

      return qb;
    };

    const sumByScope = async (range: { startDate: Date; endDate: Date }) => {
      const raw = await baseQB(range)
        .select([
          `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
          `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
          `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
        ])
        .getRawOne();

      const scope1 = Number(raw.scope1) || 0;
      const scope2 = Number(raw.scope2) || 0;
      const scope3 = Number(raw.scope3) || 0;
      const total = scope1 + scope2 + scope3;

      return { scope1, scope2, scope3, total };
    };

    const totalsComp = await sumByScope(rangeComp);
    const totalsSelected = await sumByScope(rangeSelected);

   const table1 = [
  {
    scope: "Scope 1",
    values: {
      [String(compYear)]: {
        emissions: totalsComp.scope1,
        pctOfTotal: pct(totalsComp.scope1, totalsComp.total),
      },
      [String(selectedYear)]: {
        emissions: totalsSelected.scope1,
        pctOfTotal: pct(totalsSelected.scope1, totalsSelected.total),
      },
    },
  },
  {
    scope: "Scope 2",
    values: {
      [String(compYear)]: {
        emissions: totalsComp.scope2,
        pctOfTotal: pct(totalsComp.scope2, totalsComp.total),
      },
      [String(selectedYear)]: {
        emissions: totalsSelected.scope2,
        pctOfTotal: pct(totalsSelected.scope2, totalsSelected.total),
      },
    },
  },
  {
    scope: "Scope 3",
    values: {
      [String(compYear)]: {
        emissions: totalsComp.scope3,
        pctOfTotal: pct(totalsComp.scope3, totalsComp.total),
      },
      [String(selectedYear)]: {
        emissions: totalsSelected.scope3,
        pctOfTotal: pct(totalsSelected.scope3, totalsSelected.total),
      },
    },
  },
  {
    scope: "Total Emissions (Scope 1, 2 and 3)",
    values: {
      [String(compYear)]: { emissions: totalsComp.total, pctOfTotal: 100 },
      [String(selectedYear)]: { emissions: totalsSelected.total, pctOfTotal: 100 },
    },
  },
];

     const overviewByLocations = async (range: { startDate: Date; endDate: Date }) => {
      const rows = await baseQB(range)
        .select([
          `category.scope AS "scope"`,
          `category.category_name AS "category"`,
          `site.site_id AS "siteId"`,
          `site.name AS "siteName"`,
          `COALESCE(SUM(emission.total_emission), 0) AS "value"`,
        ])
        .groupBy(`category.scope`)
        .addGroupBy(`category.category_name`)
        .addGroupBy(`site.site_id`)
        .addGroupBy(`site.name`)
        .orderBy(`category.scope`, "ASC")
        .addOrderBy(`category.category_name`, "ASC")
        .addOrderBy(`site.name`, "ASC")
        .getRawMany();

      const map = new Map<
        string,
        {
          scope: string;
          category: string;
          bySite: { siteId: number; siteName: string; value: number }[];
          total: number;
        }
      >();

      for (const r of rows) {
        const scope = String(r.scope || "");
        const category = String(r.category || "");
        const siteId = Number(r.siteId);
        const siteName = String(r.siteName || "");
        const value = Number(r.value) || 0;

        const k = `${scope}||${category}`;
        if (!map.has(k)) {
          map.set(k, { scope, category, bySite: [], total: 0 });
        }

        const item = map.get(k)!;
        item.bySite.push({ siteId, siteName, value: Number(value.toFixed(2)) });
        item.total += value;
      }

      return Array.from(map.values()).map((x) => ({
        scope: x.scope,
        category: x.category,
        bySite: x.bySite,
        total: Number(x.total.toFixed(2)),
      }));
    };

    const overviewComp = await overviewByLocations(rangeComp);
    const overviewSelected = await overviewByLocations(rangeSelected);

    return res.status(200).json({
      filters: {
        siteIds,
        categoryIds: categoryIds?.length ? categoryIds : null,
        yearType,
        year: selectedYear,
        compareYear: compYear,
        fiscalYearRule: "Apr 1 → Mar 31",
      },
      ranges: {
        [String(compYear)]: rangeComp,
        [String(selectedYear)]: rangeSelected,
      },
      totals: {
        [String(compYear)]: totalsComp,
        [String(selectedYear)]: totalsSelected,
      },
      tables: {
        table1_emissionsByScope_twoYears: table1,
        table_overviewByLocations_compareYear: {
          year: compYear,
          rows: overviewComp,
        },
        table_overviewByLocations_selectedYear: {
          year: selectedYear,
          rows: overviewSelected,
        },
      },
    });

  }
  catch(error)
  {

    console.error("GHG report tables error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

type GhgDetailsRequest = {
  siteIds: number[];
  categoryIds?: number[];
  yearType: YearType; 
  year: number;      
  compareYear?: number; 
};

type AggRow = {
  scope: string;
  categoryId: number;
  categoryName: string;
  siteId: number;
  siteName: string;
  fuelType: string;
  consumption: number;
  unit: string;
  emissions: number;
};

type YearBlock = { consumption: number; unit: string; emissions: number };

export const getGhgReportDetails = async (req: Request, res: Response) => {
  try {
    const { siteIds, categoryIds, yearType, year, compareYear } = req.body as GhgDetailsRequest;

    if (!siteIds || siteIds.length === 0) {
      return res.status(400).json({ message: "siteIds is required" });
    }
    if (!year || !yearType) {
      return res.status(400).json({ message: "yearType and year are required" });
    }
    if (yearType !== "CY" && yearType !== "FY") {
      return res.status(400).json({ message: "yearType must be CY or FY" });
    }

    const selectedYear = year;
    const compYear = compareYear ?? year - 1;

    const rangeComp = getDateRange(yearType, compYear);
    const rangeSelected = getDateRange(yearType, selectedYear);

    const repo = AppDataSource.getRepository(Emission);

    const fuelExpr = `
      COALESCE(
        NULLIF(emission.activity_data->>'fuelType', ''),
        NULLIF(emission.activity_data->>'emission_category', ''),
        'Unknown'
      )
    `;

     const consumptionExpr = `
      COALESCE(
        NULLIF((emission.activity_data->>'Activity Data')::numeric, NULL),
        NULLIF((emission.activity_data->>'activity_value')::numeric, NULL),
        NULLIF((emission.activity_data->>'value')::numeric, NULL),
        NULLIF((emission.activity_data->>'quantity')::numeric, NULL),
        0
      )
    `;

     const unitExpr = `
  COALESCE(
    NULLIF(emission.activity_data_unit, ''),
    ''
  )
`;


     const buildAgg = async (range: { startDate: Date; endDate: Date }) => {
      const qb = repo
        .createQueryBuilder("emission")
        .leftJoin("emission.site", "site")
        .leftJoin("emission.category", "category")
        .where("emission.status = :status", { status: EmissionStatus.APPROVED })
        .andWhere("site.site_id IN (:...siteIds)", { siteIds })
        .andWhere("emission.date_of_reporting >= :startDate", { startDate: range.startDate })
        .andWhere("emission.date_of_reporting <= :endDate", { endDate: range.endDate });

      if (categoryIds && categoryIds.length > 0) {
        qb.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
      }
       const raw = await qb
        .select([
          `category.scope AS "scope"`,
          `category.category_id AS "categoryId"`,
          `category.category_name AS "categoryName"`,
          `site.site_id AS "siteId"`,
          `site.name AS "siteName"`,

          `${fuelExpr} AS "fuelType"`,
          `${unitExpr} AS "unit"`,

          `COALESCE(SUM(${consumptionExpr}), 0) AS "consumption"`,
          `COALESCE(SUM(emission.total_emission), 0) AS "emissions"`,
        ])
        .groupBy(`category.scope`)
        .addGroupBy(`category.category_id`)
        .addGroupBy(`category.category_name`)
        .addGroupBy(`site.site_id`)
        .addGroupBy(`site.name`)
        .addGroupBy(fuelExpr)
        .addGroupBy(unitExpr)
        .orderBy(`category.scope`, "ASC")
        .addOrderBy(`category.category_name`, "ASC")
        .addOrderBy(`site.name`, "ASC")
        .addOrderBy(`"fuelType"`, "ASC")
        .getRawMany();

      const rows: AggRow[] = raw.map((r: any) => ({
        scope: String(r.scope ?? ""),
        categoryId: Number(r.categoryId),
        categoryName: String(r.categoryName ?? ""),
        siteId: Number(r.siteId),
        siteName: String(r.siteName ?? ""),
        fuelType: String(r.fuelType ?? "Unknown"),
        unit: String(r.unit ?? ""),
        consumption: Number(r.consumption) || 0,
        emissions: Number(r.emissions) || 0,
      }));

      return rows;
    };

    const [compareRows, selectedRows] = await Promise.all([
      buildAgg(rangeComp),
      buildAgg(rangeSelected),
    ]);
    const keyOf = (r: AggRow) => `${r.scope}||${r.categoryId}||${r.fuelType}||${r.siteId}`;

    const map = new Map<
      string,
      {
        scope: string;
        categoryId: number;
        categoryName: string;
        fuelType: string;
        siteId: number;
        siteName: string;
        compare: YearBlock;
        selected: YearBlock;
      }
    >();

    const initYear = (): YearBlock => ({ consumption: 0, unit: "", emissions: 0 });

    for (const r of compareRows) {
      const k = keyOf(r);
      if (!map.has(k)) {
        map.set(k, {
          scope: r.scope,
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          fuelType: r.fuelType,
          siteId: r.siteId,
          siteName: r.siteName,
          compare: initYear(),
          selected: initYear(),
        });
      }
      const item = map.get(k)!;
      item.compare = {
        consumption: Number(r.consumption.toFixed(2)),
        unit: r.unit,
        emissions: Number(r.emissions.toFixed(2)),
      };
    }

    for (const r of selectedRows) {
      const k = keyOf(r);
      if (!map.has(k)) {
        map.set(k, {
          scope: r.scope,
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          fuelType: r.fuelType,
          siteId: r.siteId,
          siteName: r.siteName,
          compare: initYear(),
          selected: initYear(),
        });
      }
      const item = map.get(k)!;
      item.selected = {
        consumption: Number(r.consumption.toFixed(2)),
        unit: r.unit,
        emissions: Number(r.emissions.toFixed(2)),
      };
       if (!item.compare.unit) item.compare.unit = r.unit;
    }

    const rows = Array.from(map.values());

    return res.status(200).json({
      filters: {
        siteIds,
        categoryIds: categoryIds?.length ? categoryIds : null,
        yearType,
        year: selectedYear,
        compareYear: compYear,
        fiscalYearRule: "Apr 1 → Mar 31",
      },
      ranges: {
        [String(compYear)]: rangeComp,
        [String(selectedYear)]: rangeSelected,
      },
      rows,
    });
  } catch (error) {
    console.error("GHG report details error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};