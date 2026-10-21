/**
 * The SBTi target computations behind POST /user/targets/tables and
 * /user/targets/long-term-chart (IN-1 extraction, refactor only): moved here
 * from controllers/emission.controller.ts unchanged so src/insights can read
 * the same pathway figures. A bad request throws SbtiInputError, which the
 * controllers answer as 400 { message } exactly as before.
 */
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";

export class SbtiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SbtiInputError";
  }
}

function yearStartEnd(year: number) {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  return { startDate, endDate };
}

function powTarget(base: number, rate: number, n: number) {
  // Protect against negative/NaN
  const r = Math.max(0, Math.min(rate, 1));
  return base * Math.pow(1 - r, n);
}


export async function computeNearTermTables(input: unknown) {
  const { siteIds, baseYear, targetYear, annualRate } = input as {
    siteIds: number[];
    baseYear: number;
    targetYear: number;
    annualRate?: number;
  };

  if (!siteIds?.length || !baseYear || !targetYear) {
    throw new SbtiInputError("siteIds, baseYear and targetYear are required");
  }

  const horizonYears = targetYear - baseYear;

  if (horizonYears < 5 || horizonYears > 10) {
    throw new SbtiInputError(`Target year must be 5 to 10 years from base year as per SBTi Near-Term rules. Got ${horizonYears} years.`);
  }

  const RATE = typeof annualRate === "number" ? annualRate : 0.042;

  const repo = AppDataSource.getRepository(Emission);

  const buildBaseQuery = (startDate: Date, endDate: Date) => {
    return repo
      .createQueryBuilder("emission")
      .leftJoin("emission.category", "category")
      .leftJoin("emission.site", "site")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate })
      .andWhere("LOWER(category.category_name) != :ren", { ren: "renewable electricity" });
  };

  const getTotalsForYear = async (year: number) => {
    const { startDate, endDate } = yearStartEnd(year);

    const raw = await buildBaseQuery(startDate, endDate)
      .select([
        `SUM(CASE WHEN LOWER(category.scope) = 'scope 1' THEN emission.total_emission ELSE 0 END) AS "scope1"`,
        `SUM(CASE WHEN LOWER(category.scope) = 'scope 2' THEN emission.total_emission ELSE 0 END) AS "scope2"`,
        `SUM(CASE WHEN LOWER(category.scope) = 'scope 3' THEN emission.total_emission ELSE 0 END) AS "scope3"`,
      ])
      .getRawOne();

    const scope1 = Number(raw?.scope1) || 0;
    const scope2 = Number(raw?.scope2) || 0;
    const scope3 = Number(raw?.scope3) || 0;

    return { scope1, scope2, scope3, total: scope1 + scope2 + scope3 };
  };

  const baseTotalsAll = await getTotalsForYear(baseYear);

  if (!baseTotalsAll.total) {
    throw new SbtiInputError(`No approved emissions found for baseYear=${baseYear} with the provided filters.`);
  }

  const scope3Share = baseTotalsAll.total > 0 ? baseTotalsAll.scope3 / baseTotalsAll.total : 0;
  const scope3TargetRequired = scope3Share >= 0.4;

  const scope1And2Total = baseTotalsAll.scope1 + baseTotalsAll.scope2;
  const scope1And2CoveragePct =
    baseTotalsAll.total > 0 ? (scope1And2Total / baseTotalsAll.total) * 100 : 0;
  const scope1And2CoverageValid = scope1And2CoveragePct >= 95;

  const targetBoundaryBase = scope3TargetRequired
    ? baseTotalsAll.scope1 + baseTotalsAll.scope2 + baseTotalsAll.scope3
    : baseTotalsAll.scope1 + baseTotalsAll.scope2;

  const table1: Array<{
    year: number;
    n: number;
    calculation: string;
    targetEmission: number;
    reducedBy: number | null;
    reducedByPct: number | null;
  }> = [];

  const table2: Array<{
    year: number;
    n: number;
    scope1Target: number;
    scope2Target: number;
    scope3Target: number | null;
    totalTarget: number;
    reducedBy: number | null;
    reducedByPct: number | null;
  }> = [];

  for (let year = baseYear; year <= targetYear; year++) {
    const n = year - baseYear;

    const totalTarget = powTarget(targetBoundaryBase, RATE, n);
    const scope1Target = powTarget(baseTotalsAll.scope1, RATE, n);
    const scope2Target = powTarget(baseTotalsAll.scope2, RATE, n);
    const scope3Target = scope3TargetRequired ? powTarget(baseTotalsAll.scope3, RATE, n) : null;
    const totalFromScopes = scope1Target + scope2Target + (scope3Target ?? 0);

    const prevTotalTarget = n === 0 ? null : powTarget(targetBoundaryBase, RATE, n - 1);
    const reducedBy = prevTotalTarget === null ? null : prevTotalTarget - totalTarget;
    const reducedByPct =
      prevTotalTarget === null || prevTotalTarget === 0
        ? null
        : (reducedBy! / prevTotalTarget) * 100;

    table1.push({
      year,
      n,
      calculation: `${targetBoundaryBase.toFixed(0)} × (${(1 - RATE).toFixed(3)})^${n}`,
      targetEmission: Number(totalTarget.toFixed(3)),
      reducedBy: reducedBy === null ? null : Number(reducedBy.toFixed(3)),
      reducedByPct: reducedByPct === null ? null : Number(reducedByPct.toFixed(3)),
    });

    table2.push({
      year,
      n,
      scope1Target: Number(scope1Target.toFixed(3)),
      scope2Target: Number(scope2Target.toFixed(3)),
      scope3Target: scope3Target === null ? null : Number(scope3Target.toFixed(3)),
      totalTarget: Number(totalFromScopes.toFixed(3)),
      reducedBy: reducedBy === null ? null : Number(reducedBy.toFixed(3)),
      reducedByPct: reducedByPct === null ? null : Number(reducedByPct.toFixed(3)),
    });
  }

  const table3: Array<{
    year: number;
    actualScope1: number;
    actualScope2: number;
    actualScope3: number | null;
    actualTotal: number;
    targetTotal: number;
    variance: number;
    variancePct: number | null;
    status: "Base Year" | "Reached" | "Not Reached" | "No Data";
  }> = [];

  for (let year = baseYear; year <= targetYear; year++) {
    const actualAll = await getTotalsForYear(year);
    const targetTotal = table1.find((r) => r.year === year)!.targetEmission;

    const actualBoundaryTotal = scope3TargetRequired
      ? actualAll.scope1 + actualAll.scope2 + actualAll.scope3
      : actualAll.scope1 + actualAll.scope2;

    const isBaseYear = year === baseYear;
    const hasBoundaryData = actualBoundaryTotal > 0;
    const variance = hasBoundaryData ? actualBoundaryTotal - targetTotal : 0;
    const variancePct =
      hasBoundaryData && targetTotal > 0 ? (variance / targetTotal) * 100 : null;

    table3.push({
      year,
      actualScope1: Number(actualAll.scope1.toFixed(3)),
      actualScope2: Number(actualAll.scope2.toFixed(3)),
      actualScope3: scope3TargetRequired ? Number(actualAll.scope3.toFixed(3)) : null,
      actualTotal: Number(actualBoundaryTotal.toFixed(3)),
      targetTotal: Number(targetTotal.toFixed(3)),
      variance: Number(variance.toFixed(3)),
      variancePct: variancePct === null ? null : Number(variancePct.toFixed(2)),
      status: isBaseYear
        ? "Base Year"
        : !hasBoundaryData
        ? "No Data"
        : actualBoundaryTotal <= targetTotal
        ? "Reached"
        : "Not Reached",
    });
  }

  return {
    heading: "Near-Term Target",
    method: "ABSOLUTE_CONTRACTION",
    annualRate: RATE,
    baseYear,
    targetYear,
    horizonYears,
    scope3Share: Number((scope3Share * 100).toFixed(2)),
    scope3TargetRequired,
    scope1And2CoveragePct: Number(scope1And2CoveragePct.toFixed(2)),
    scope1And2CoverageValid,
    baseTotals: baseTotalsAll,
    targetBoundaryBase: Number(targetBoundaryBase.toFixed(3)),
    tables: { table1, table2, table3 },
  };
}

export async function computeLongTermChart(input: unknown) {
  const { siteIds, baseYear } = input as {
    siteIds: number[];
    baseYear: number;
  };

  if (!siteIds?.length || !baseYear) {
    throw new SbtiInputError("siteIds and baseYear are required");
  }

  const NET_ZERO_YEAR = 2050;
  const NET_ZERO_REDUCTION = 0.9;

  if (baseYear >= NET_ZERO_YEAR) {
    throw new SbtiInputError("Base year must be before 2050.");
  }

  const years = NET_ZERO_YEAR - baseYear;

  const repo = AppDataSource.getRepository(Emission);

  const buildBaseQuery = (startDate: Date, endDate: Date) => {
    return repo
      .createQueryBuilder("emission")
      .leftJoin("emission.category", "category")
      .leftJoin("emission.site", "site")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate })
      .andWhere("LOWER(category.category_name) != :ren", { ren: "renewable electricity" });
  };

  const getTotalsForYear = async (year: number) => {
    const { startDate, endDate } = yearStartEnd(year);
    const raw = await buildBaseQuery(startDate, endDate)
      .select([
        `SUM(CASE WHEN LOWER(category.scope) = 'scope 1' THEN emission.total_emission ELSE 0 END) AS "scope1"`,
        `SUM(CASE WHEN LOWER(category.scope) = 'scope 2' THEN emission.total_emission ELSE 0 END) AS "scope2"`,
        `SUM(CASE WHEN LOWER(category.scope) = 'scope 3' THEN emission.total_emission ELSE 0 END) AS "scope3"`,
      ])
      .getRawOne();

    const scope1 = Number(raw?.scope1) || 0;
    const scope2 = Number(raw?.scope2) || 0;
    const scope3 = Number(raw?.scope3) || 0;

    return { scope1, scope2, scope3, total: scope1 + scope2 + scope3 };
  };

  const getMaxDataYear = async () => {
    const raw = await repo
      .createQueryBuilder("emission")
      .leftJoin("emission.category", "category")
      .leftJoin("emission.site", "site")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("LOWER(category.category_name) != :ren", { ren: "renewable electricity" })
      .select(`MAX(EXTRACT(YEAR FROM emission.date_of_reporting))`, "maxYear")
      .getRawOne();

    const maxYear = Number(raw?.maxYear);
    return Number.isFinite(maxYear) ? maxYear : baseYear;
  };

  const baseTotals = await getTotalsForYear(baseYear);

  if (!baseTotals.total) {
    throw new SbtiInputError(`No approved emissions found for baseYear=${baseYear}.`);
  }

  const scope3Share = baseTotals.total > 0 ? baseTotals.scope3 / baseTotals.total : 0;
  const scope3TargetRequired = scope3Share >= 0.4;

  const baselineBoundary = scope3TargetRequired
    ? baseTotals.scope1 + baseTotals.scope2 + baseTotals.scope3
    : baseTotals.scope1 + baseTotals.scope2;

  const targetEmissions = Number((baselineBoundary * (1 - NET_ZERO_REDUCTION)).toFixed(3));

  const annualRate = 1 - Math.pow(targetEmissions / baselineBoundary, 1 / years);

  const rows: Array<{
    year: number;
    n: number;
    targetEmission: number;
    scope1Target: number;
    scope2Target: number;
    scope3Target: number | null;
    reducedBy: number | null;
    reducedByPct: number | null;
  }> = [];

  for (let year = baseYear; year <= NET_ZERO_YEAR; year++) {
    const n = year - baseYear;
    const factor = Math.pow(1 - annualRate, n);

    const totalTarget = Number((baselineBoundary * factor).toFixed(3));
    const scope1Target = Number((baseTotals.scope1 * factor).toFixed(3));
    const scope2Target = Number((baseTotals.scope2 * factor).toFixed(3));
    const scope3Target = scope3TargetRequired ? Number((baseTotals.scope3 * factor).toFixed(3)) : null;

    const prevTotal =
      n === 0 ? null : Number((baselineBoundary * Math.pow(1 - annualRate, n - 1)).toFixed(3));
    const reducedBy = prevTotal === null ? null : Number((prevTotal - totalTarget).toFixed(3));
    const reducedByPct =
      prevTotal === null || prevTotal === 0 ? null : Number(((reducedBy! / prevTotal) * 100).toFixed(3));

    rows.push({
      year,
      n,
      targetEmission: totalTarget,
      scope1Target,
      scope2Target,
      scope3Target,
      reducedBy,
      reducedByPct,
    });
  }

  const targetByYear = new Map(rows.map((r) => [r.year, r]));

  const currentYear = new Date().getFullYear();
  const maxDataYear = await getMaxDataYear();

  const endYear = Math.min(NET_ZERO_YEAR, Math.max(currentYear, maxDataYear));

  const actualVsTargetRows: Array<{
    year: number;
    actualScope1: number | null;
    actualScope2: number | null;
    actualScope3: number | null;
    actualTotal: number | null;
    targetTotal: number;
    variance: number | null;
    variancePct: number | null;
    status: "Base Year" | "Reached" | "Not Reached" | "No Data";
  }> = [];

  for (let year = baseYear; year <= endYear; year++) {
    const targetRow = targetByYear.get(year);
    if (!targetRow) continue;

    const actualTotals = await getTotalsForYear(year);

    const isBase = year === baseYear;
    const hasData = actualTotals.total > 0;

    const actualBoundaryTotal = scope3TargetRequired
      ? actualTotals.scope1 + actualTotals.scope2 + actualTotals.scope3
      : actualTotals.scope1 + actualTotals.scope2;

    let status: "Base Year" | "Reached" | "Not Reached" | "No Data";
    if (isBase) status = "Base Year";
    else if (!hasData) status = "No Data";
    else status = actualBoundaryTotal <= targetRow.targetEmission ? "Reached" : "Not Reached";

    const variance = hasData || isBase ? Number((actualBoundaryTotal - targetRow.targetEmission).toFixed(3)) : null;

    const variancePct =
      hasData || isBase
        ? targetRow.targetEmission > 0
          ? Number(((variance! / targetRow.targetEmission) * 100).toFixed(2))
          : null
        : null;

    actualVsTargetRows.push({
      year,
      actualScope1: hasData || isBase ? Number(actualTotals.scope1.toFixed(3)) : null,
      actualScope2: hasData || isBase ? Number(actualTotals.scope2.toFixed(3)) : null,
      actualScope3: scope3TargetRequired && (hasData || isBase) ? Number(actualTotals.scope3.toFixed(3)) : null,
      actualTotal: hasData || isBase ? Number(actualBoundaryTotal.toFixed(3)) : null,
      targetTotal: targetRow.targetEmission,
      variance,
      variancePct,
      status,
    });
  }

  return {
    heading: "Net-Zero Target",
    method: "NET_ZERO_90",
    baseYear,
    targetYear: NET_ZERO_YEAR,
    years,
    annualRate: Number((annualRate * 100).toFixed(4)),
    baseEmissions: Number(baselineBoundary.toFixed(3)),
    targetEmissions,
    totalReductionPct: 90,
    scope3Share: Number((scope3Share * 100).toFixed(2)),
    scope3TargetRequired,
    baseTotals,
    rows,
    actualVsTarget: actualVsTargetRows,
  };
}
