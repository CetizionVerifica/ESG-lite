/**
 * Per-site emission intensity behind GET /user/emission-intensity/comparison
 * (IN-1 extraction, refactor only): moved here from
 * controllers/productionData.controller.ts unchanged so src/insights reads the
 * same intensity Overview shows. Approved emissions with a scope over approved
 * production overlapping the range.
 */
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";
import { ProductionData, ProductionDataStatus } from "../entities/ProductionData";
import { kgToTonnes, sumKgSql } from "../reporting/kgTotals";

export async function emissionIntensityComparison(siteIdArray: number[], dateFilter: { startDate: Date; endDate: Date }) {
  const emissionRepo = AppDataSource.getRepository(Emission);
  const repo = AppDataSource.getRepository(ProductionData);
  return Promise.all(
    siteIdArray.map(async (siteId) => {
      // Get emissions (excluding null-scope categories like Renewable Electricity)
      const emissionsResult = await emissionRepo
        .createQueryBuilder("e")
        .leftJoin("e.category", "category")
        .select(sumKgSql("e"), "kg") // D14: the rows' kg, rounded once
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

      const emissions = kgToTonnes(emissionsResult?.kg);
      const production = parseFloat(productionResult?.totalProduction || 0);

      return {
        siteId,
        totalEmissions: emissions,
        totalProduction: production,
        emissionIntensity: production > 0 ? emissions / production : 0,
      };
    })
  );
}
