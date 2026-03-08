/**
 * Auto-generate column config proposals from emission factor names.
 *
 * Algorithm:
 *  1. Fetch distinct emission_category_name + denominator_unit for site+category
 *  2. Group by denominator_unit
 *  3. Split names by " - " delimiter, detect dominant dimension count
 *  4. Extract unique values per dimension → dropdown options
 *  5. Build column_dependencies, dependent_options, emission_category_mapping
 *  6. Call Python LLM for column name inference
 *  7. Match against existing column_entity records
 *  8. Return complete proposal for preview
 */

import { AppDataSource } from "../config/data-source";
import { EmissionFactor } from "../entities/EmissionFactor";
import { ColumnEntity } from "../entities/Column";
import {
  ColumnConfig,
  ColumnOptionsMap,
  ColumnDependencies,
  DependentOptionsMap,
  EmissionCategoryMapping,
  DropdownOptionValue,
} from "../entities/ColumnConfig";
import { EmissionCategoryMapping as ECMEntity } from "../entities/EmissionCategoryMapping";
import { Unit } from "../entities/Unit";
import { Category } from "../entities/Category";
import { Site } from "../entities/Site";
import { IsNull } from "typeorm";

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || "http://localhost:8000";

// ─── Public Types ───────────────────────────────────────────────────────────

export type PatternType = "FLAT" | "TWO_DIM" | "THREE_DIM";

export interface ProposedColumn {
  existing_id: number | null;
  column_name: string;
  column_type: "number" | "select";
  is_new: boolean;
}

export interface DimColumnNames {
  columns: ProposedColumn[];
  activity_column_name: string;
}

export interface EfNamePair {
  display_name: string;   // company_category_name (from ECM) or emission_category_name (from EF)
  lookup_name: string;    // emission_category_name for EF lookup
}

export interface ProposedConfigGroup {
  denominator_unit: string;
  pattern: PatternType;
  columns: ProposedColumn[];
  column_options: ColumnOptionsMap;
  column_dependencies: ColumnDependencies;
  dependent_options: DependentOptionsMap;
  emission_category_mapping: EmissionCategoryMapping;
  ef_names: string[];
  ef_name_pairs?: EfNamePair[];
  source: "ecm" | "ef";
  column_names_by_dim: Record<number, DimColumnNames>;
}

export interface ProposedUnit {
  unit_name: string;
  already_exists: boolean;
}

export interface ColumnConfigProposal {
  config_name: string;
  site_id: number;
  category_id: number;
  site_name: string;
  category_name: string;
  configs: ProposedConfigGroup[];
  proposed_units: ProposedUnit[];
  existing_config_ids: number[];
}

// ─── LLM Response Types ────────────────────────────────────────────────────

interface LLMInferredColumn {
  position: number;
  suggested_name: string;
  reuse_existing: string | null;
}

interface LLMInferColumnsResponse {
  columns: LLMInferredColumn[];
  activity_column_name: string;
  suggested_units: string[];
}

interface LLMInferAllGroupResult {
  dim_count: number;
  columns: LLMInferredColumn[];
  activity_column_name: string;
}

interface LLMInferAllColumnsResponse {
  groups: LLMInferAllGroupResult[];
  suggested_units: string[];
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface ParsedEntry {
  original: string;
  parts: string[];
}

interface DimensionData {
  position: number;
  values: string[];
}

// ─── ECM Fetch ─────────────────────────────────────────────────────────────

interface ECMFetchResult {
  company_category_name: string;
  global_category_name: string;
  emission_category_name: string;
  denominator_unit: string;
}

async function fetchFromECM(
  siteId: number,
  categoryId: number,
  companyId: number
): Promise<ECMFetchResult[]> {
  const ecmRepo = AppDataSource.getRepository(ECMEntity);
  const efRepo = AppDataSource.getRepository(EmissionFactor);

  // Fetch ECM rows with linked EF data (LEFT JOIN via emission_factor_id)
  const ecmRows = await ecmRepo
    .createQueryBuilder("ecm")
    .leftJoinAndMapOne(
      "ecm._ef",
      EmissionFactor,
      "ef",
      "ef.emission_factor_id = ecm.emission_factor_id"
    )
    .select([
      "ecm.id",
      "ecm.company_category_name",
      "ecm.global_category_name",
      "ecm.site_id",
      "ecm.emission_factor_id",
    ])
    .addSelect("ef.emission_category_name", "ef_emission_category_name")
    .addSelect("ef.denominator_unit", "ef_denominator_unit")
    .where("ecm.company_id = :companyId", { companyId })
    .andWhere("ecm.category_id = :categoryId", { categoryId })
    .andWhere("(ecm.site_id = :siteId OR ecm.site_id IS NULL)", { siteId })
    .getRawMany();

  if (ecmRows.length === 0) return [];

  // Two-tier resolution: site-specific overrides company-wide
  const resolved = new Map<
    string,
    {
      company_category_name: string;
      global_category_name: string;
      site_id: number | null;
      emission_factor_id: number | null;
      ef_emission_category_name: string | null;
      ef_denominator_unit: string | null;
    }
  >();

  for (const row of ecmRows) {
    const key = row.ecm_company_category_name;
    const existing = resolved.get(key);
    const rowSiteId = row.ecm_site_id;
    // Site-specific (non-null site_id) takes priority
    if (!existing || (rowSiteId !== null && existing.site_id === null)) {
      resolved.set(key, {
        company_category_name: row.ecm_company_category_name,
        global_category_name: row.ecm_global_category_name,
        site_id: rowSiteId,
        emission_factor_id: row.ecm_emission_factor_id,
        ef_emission_category_name: row.ef_emission_category_name,
        ef_denominator_unit: row.ef_denominator_unit,
      });
    }
  }

  // Build results, resolving missing EF data via secondary lookup
  const results: ECMFetchResult[] = [];

  for (const entry of resolved.values()) {
    let emissionCategoryName = entry.ef_emission_category_name;
    let denominatorUnit = entry.ef_denominator_unit;

    // If no linked EF, try secondary lookup by global_category_name
    if (!emissionCategoryName || !denominatorUnit) {
      const fallbackEf = await efRepo.findOne({
        where: [
          {
            site: { site_id: siteId },
            category: { category_id: categoryId },
            emission_category_name: entry.global_category_name,
          },
          {
            site: { site_id: siteId },
            category: { category_id: categoryId },
            global_category_name: entry.global_category_name,
          },
        ],
      });

      if (fallbackEf) {
        emissionCategoryName = emissionCategoryName || fallbackEf.emission_category_name;
        denominatorUnit = denominatorUnit || fallbackEf.denominator_unit;
      }
    }

    // Skip rows where we can't determine denominator_unit
    if (!denominatorUnit) {
      console.warn(
        `ECM row "${entry.company_category_name}" has no matching emission factor — skipping`
      );
      continue;
    }

    results.push({
      company_category_name: entry.company_category_name,
      global_category_name: entry.global_category_name,
      emission_category_name: emissionCategoryName || entry.global_category_name,
      denominator_unit: denominatorUnit,
    });
  }

  return results;
}

// ─── Core Function ──────────────────────────────────────────────────────────

export async function generateColumnConfigProposal(
  siteId: number,
  categoryId: number
): Promise<ColumnConfigProposal> {
  const efRepo = AppDataSource.getRepository(EmissionFactor);
  const columnRepo = AppDataSource.getRepository(ColumnEntity);
  const unitRepo = AppDataSource.getRepository(Unit);
  const configRepo = AppDataSource.getRepository(ColumnConfig);
  const siteRepo = AppDataSource.getRepository(Site);
  const categoryRepo = AppDataSource.getRepository(Category);

  // 1. Fetch site (with company relation) and category
  const site = await siteRepo.findOne({
    where: { site_id: siteId },
    relations: ["company"],
  });
  const category = await categoryRepo.findOne({ where: { category_id: categoryId } });

  if (!site) throw new Error("Site not found");
  if (!category) throw new Error("Category not found");

  // 2. Try ECM first, fall back to emission_factors
  let usingECM = false;
  const unitGroups = new Map<string, ParsedEntry[]>();
  const efNamePairsMap = new Map<string, EfNamePair[]>();

  const companyId = site.company?.company_id;
  if (companyId) {
    const ecmResults = await fetchFromECM(siteId, categoryId, companyId);
    if (ecmResults.length > 0) {
      usingECM = true;
      for (const row of ecmResults) {
        const unit = (row.denominator_unit || "unknown").trim().toLowerCase();
        if (!unitGroups.has(unit)) {
          unitGroups.set(unit, []);
          efNamePairsMap.set(unit, []);
        }
        unitGroups.get(unit)!.push({
          original: row.global_category_name,                // for EF lookup (JSONB value) — primary: global_category_name
          parts: row.company_category_name.split(" - ").map((p) => p.trim()), // for dropdown labels
        });
        efNamePairsMap.get(unit)!.push({
          display_name: row.company_category_name,
          lookup_name: row.global_category_name,
        });
      }
    }
  }

  // Fall back to emission_factors if no ECM data
  if (!usingECM) {
    const efData: { emission_category_name: string; denominator_unit: string }[] =
      await efRepo
        .createQueryBuilder("ef")
        .select("ef.emission_category_name", "emission_category_name")
        .addSelect("ef.denominator_unit", "denominator_unit")
        .where("ef.site_id = :siteId", { siteId })
        .andWhere("ef.category_id = :categoryId", { categoryId })
        .andWhere("ef.emission_category_name IS NOT NULL")
        .andWhere("ef.emission_category_name != ''")
        .groupBy("ef.emission_category_name")
        .addGroupBy("ef.denominator_unit")
        .getRawMany();

    if (efData.length === 0) {
      throw new Error(
        "No emission category mappings or emission factors found for this site and category"
      );
    }

    for (const row of efData) {
      const unit = (row.denominator_unit || "unknown").trim().toLowerCase();
      if (!unitGroups.has(unit)) unitGroups.set(unit, []);
      unitGroups.get(unit)!.push({
        original: row.emission_category_name,
        parts: row.emission_category_name.split(" - ").map((p) => p.trim()),
      });
    }
  }

  // 4. Fetch existing column entities for matching
  const existingColumns = await columnRepo.find();
  const existingColumnNames = existingColumns.map((c) => c.column_name);

  // 5. Fetch existing units for site+category
  const existingUnits = await unitRepo.find({
    where: { site: { site_id: siteId }, category: { category_id: categoryId } },
  });
  const existingUnitNames = new Set(existingUnits.map((u) => u.unit_name.toLowerCase()));

  // 6. Check existing column configs
  const existingConfigs = await configRepo.find({
    where: { site: { site_id: siteId }, category: { category_id: categoryId } },
  });

  // 7. Process each unit group
  const configs: ProposedConfigGroup[] = [];
  const allSuggestedUnits: string[] = [];

  for (const [unit, parsed] of unitGroups) {
    const pattern = detectPattern(parsed);

    // Filter to only entries matching the dominant dimension count exactly
    const expectedDimCount = pattern === "THREE_DIM" ? 3 : pattern === "TWO_DIM" ? 2 : 1;
    const filteredParsed = pattern === "THREE_DIM"
      ? promoteToThreeDim(parsed)
      : parsed.filter((p) => p.parts.length === expectedDimCount);
    const dimensions = extractDimensions(filteredParsed, pattern);

    // Detect ALL available dimension counts for this unit group
    const partCountFreq = new Map<number, number>();
    for (const entry of parsed) {
      const pc = entry.parts.length;
      partCountFreq.set(pc, (partCountFreq.get(pc) || 0) + 1);
    }
    const availableDimCounts = [...partCountFreq.keys()].filter((c) => c >= 1 && c <= 4).sort();

    // Build dimension data for each available dim count
    const dimGroups: { dimCount: number; dimensions: DimensionData[] }[] = [];
    for (const dc of availableDimCounts) {
      const dcParsed = parsed.filter((p) => p.parts.length === dc);
      const dcDims: DimensionData[] = [];
      for (let i = 0; i < dc; i++) {
        const vals = new Set<string>();
        for (const entry of dcParsed) {
          if (entry.parts.length > i) vals.add(entry.parts[i]);
        }
        dcDims.push({ position: i, values: [...vals].sort() });
      }
      dimGroups.push({ dimCount: dc, dimensions: dcDims });
    }

    // Call LLM for ALL dimension groups at once
    let llmAllResult: LLMInferAllColumnsResponse | null = null;
    let llmFallback: LLMInferColumnsResponse | null = null;
    try {
      if (dimGroups.length > 1) {
        llmAllResult = await callLLMInferAllColumns(
          category.category_name, dimGroups, unit, existingColumnNames
        );
      } else {
        // Single dim count — use the simpler endpoint
        llmFallback = await callLLMInferColumns(
          category.category_name, dimensions, unit, existingColumnNames
        );
      }
    } catch (err) {
      console.warn("LLM column inference failed, using fallback names:", err);
    }

    // Build column_names_by_dim from LLM results
    const columnNamesByDim: Record<number, DimColumnNames> = {};
    if (llmAllResult) {
      for (const groupResult of llmAllResult.groups) {
        columnNamesByDim[groupResult.dim_count] = buildColumnsFromLLM(
          groupResult.columns,
          groupResult.activity_column_name,
          groupResult.dim_count,
          existingColumns
        );
      }
    }
    // Ensure the dominant dim count always has an entry
    if (!columnNamesByDim[expectedDimCount]) {
      const llmForDominant = llmFallback;
      columnNamesByDim[expectedDimCount] = buildColumnsFromLLM(
        llmForDominant?.columns || [],
        llmForDominant?.activity_column_name || "Activity Data",
        expectedDimCount,
        existingColumns
      );
    }
    // Fill fallback for any dim count missing from LLM response
    for (const dc of availableDimCounts) {
      if (!columnNamesByDim[dc]) {
        columnNamesByDim[dc] = buildColumnsFromLLM([], "Activity Data", dc, existingColumns);
      }
    }

    // Use dominant dim count's columns for the main config
    const dominantColumns = columnNamesByDim[expectedDimCount];

    // Build ef_names: use display names (company names from ECM, or EF names)
    const displayNames = usingECM
      ? parsed.map((p) => p.parts.join(" - "))
      : parsed.map((p) => p.original);
    const pairsForUnit = efNamePairsMap.get(unit);

    const group = buildConfigGroup(
      filteredParsed,
      pattern,
      dimensions,
      unit,
      displayNames,
      dominantColumns,
      columnNamesByDim,
      existingColumns,
      usingECM ? "ecm" : "ef",
      pairsForUnit
    );
    configs.push(group);

    // Collect suggested units
    const suggestedUnits = llmAllResult?.suggested_units || llmFallback?.suggested_units;
    if (suggestedUnits?.length) {
      allSuggestedUnits.push(...suggestedUnits);
    } else {
      allSuggestedUnits.push(unit);
    }
  }

  // 8. Deduplicate and check unit existence
  const seenUnits = new Set<string>();
  const proposedUnits: ProposedUnit[] = [];
  for (const u of allSuggestedUnits) {
    const lower = u.toLowerCase().trim();
    if (seenUnits.has(lower)) continue;
    seenUnits.add(lower);
    proposedUnits.push({
      unit_name: u.trim(),
      already_exists: existingUnitNames.has(lower),
    });
  }

  // 9. Generate config name
  const configName = `${category.category_name} - Auto Generated`;

  return {
    config_name: configName,
    site_id: siteId,
    category_id: categoryId,
    site_name: site.name,
    category_name: category.category_name,
    configs,
    proposed_units: proposedUnits,
    existing_config_ids: existingConfigs.map((c) => c.pk_id),
  };
}

// ─── Pattern Detection ──────────────────────────────────────────────────────

function detectPattern(parsed: ParsedEntry[]): PatternType {
  const partCounts = parsed.map((p) => p.parts.length);
  const countFrequency = new Map<number, number>();

  for (const count of partCounts) {
    countFrequency.set(count, (countFrequency.get(count) || 0) + 1);
  }

  const total = parsed.length;
  // A dimension count is "significant" if it has at least 25% of entries (min 2).
  const minSignificant = Math.max(2, Math.ceil(total * 0.25));

  // Prefer the HIGHEST dimension count with significant representation.
  // Rationale: 2-part names like "Van - CNG" are often abbreviated forms of
  // 3-part names like "Road - Van - CNG". The higher count reflects the true
  // structure of the data.
  let bestCount = 0;
  for (const [count, freq] of countFrequency) {
    if (count >= 1 && count <= 4 && freq >= minSignificant && count > bestCount) {
      bestCount = count;
    }
  }

  // Fallback: if no count meets the threshold, use the most frequent
  if (bestCount === 0) {
    let maxFreq = 0;
    for (const [count, freq] of countFrequency) {
      if (freq > maxFreq) {
        maxFreq = freq;
        bestCount = count;
      }
    }
  }

  if (bestCount >= 3) return "THREE_DIM";
  if (bestCount === 2) return "TWO_DIM";
  return "FLAT";
}

/**
 * When THREE_DIM is the dominant pattern, promote 2-dim entries to 3-dim
 * by inferring their missing dimension from the 3-dim entries.
 *
 * This preserves entries like "Rail" that only exist in 2-part names
 * (e.g., "Road - Rail" or "Rail - Rail Fuel") by figuring out which
 * mode (dim0) they belong to.
 *
 * Deduplication: 2-dim entries that already have a 3-dim equivalent
 * (e.g., "Van - CNG" duplicating "Road - Van - CNG [tonne.km]") are skipped.
 */
function promoteToThreeDim(parsed: ParsedEntry[]): ParsedEntry[] {
  const threeDim = parsed.filter((p) => p.parts.length === 3);
  const twoDim = parsed.filter((p) => p.parts.length === 2);

  if (twoDim.length === 0) return threeDim;

  // Extract known dim0 (mode) values from 3-dim entries
  const knownModes = new Set(threeDim.map((e) => e.parts[0]));

  // Build case-insensitive vehicle→mode map from 3-dim entries
  const vehicleToMode = new Map<string, string>();
  for (const entry of threeDim) {
    const key = entry.parts[1].toLowerCase();
    if (!vehicleToMode.has(key)) {
      vehicleToMode.set(key, entry.parts[0]);
    }
  }

  // Also learn vehicle→mode from 2-dim entries where first part IS a known mode.
  // e.g., "Road - Rail" tells us Rail belongs under Road.
  for (const entry of twoDim) {
    if (knownModes.has(entry.parts[0])) {
      const key = entry.parts[1].toLowerCase();
      if (!vehicleToMode.has(key)) {
        vehicleToMode.set(key, entry.parts[0]);
      }
    }
  }

  const result = [...threeDim];

  // Normalize key for dedup: lowercase + strip unit suffix like [tonne.km] from last part
  const normalizeKey = (parts: string[]) =>
    parts
      .map((p, i) => {
        let val = p.toLowerCase().trim();
        if (i === parts.length - 1) val = val.replace(/\s*\[.*?\]\s*$/, "");
        return val;
      })
      .join("|");

  const existingKeys = new Set(threeDim.map((e) => normalizeKey(e.parts)));
  const existingModeVehicle = new Set(
    threeDim.map((e) => `${e.parts[0].toLowerCase()}|${e.parts[1].toLowerCase()}`)
  );

  for (const entry of twoDim) {
    const [first, second] = entry.parts;
    let promoted: string[] | null = null;

    if (knownModes.has(first)) {
      // e.g., "Road - Rail" → mode=Road, vehicle=Rail, fuel missing
      const mvKey = `${first.toLowerCase()}|${second.toLowerCase()}`;
      if (!existingModeVehicle.has(mvKey)) {
        promoted = [first, second, "-"];
      }
    } else {
      // e.g., "Van - CNG" or "Rail - Rail Fuel" → look up mode for first part
      const mode = vehicleToMode.get(first.toLowerCase());
      if (mode) {
        promoted = [mode, first, second];
      }
    }

    if (promoted) {
      const key = normalizeKey(promoted);
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        existingModeVehicle.add(
          `${promoted[0].toLowerCase()}|${promoted[1].toLowerCase()}`
        );
        result.push({ original: entry.original, parts: promoted });
      }
    }
  }

  return result;
}

// ─── Dimension Extraction ───────────────────────────────────────────────────

function extractDimensions(
  parsed: ParsedEntry[],
  pattern: PatternType
): DimensionData[] {
  const dimCount = pattern === "THREE_DIM" ? 3 : pattern === "TWO_DIM" ? 2 : 1;
  const dimensions: DimensionData[] = [];

  for (let i = 0; i < dimCount; i++) {
    const values = new Set<string>();
    for (const entry of parsed) {
      if (entry.parts.length > i) {
        values.add(entry.parts[i]);
      }
    }
    dimensions.push({
      position: i,
      values: [...values].sort(),
    });
  }

  return dimensions;
}

// ─── LLM Call ───────────────────────────────────────────────────────────────

async function callLLMInferColumns(
  categoryName: string,
  dimensions: DimensionData[],
  denominatorUnit: string,
  existingColumnNames: string[]
): Promise<LLMInferColumnsResponse> {
  const body = {
    category_name: categoryName,
    dimensions: dimensions.map((d) => ({
      position: d.position,
      sample_values: d.values.slice(0, 15),
    })),
    denominator_unit: denominatorUnit,
    existing_columns: existingColumnNames,
  };

  const response = await fetch(`${OCR_SERVICE_URL}/v1/column-config/infer-columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM inference returned ${response.status}: ${text}`);
  }

  return response.json();
}

async function callLLMInferAllColumns(
  categoryName: string,
  dimGroups: { dimCount: number; dimensions: DimensionData[] }[],
  denominatorUnit: string,
  existingColumnNames: string[]
): Promise<LLMInferAllColumnsResponse> {
  const body = {
    category_name: categoryName,
    dimension_groups: dimGroups.map((g) => ({
      dim_count: g.dimCount,
      dimensions: g.dimensions.map((d) => ({
        position: d.position,
        sample_values: d.values.slice(0, 15),
      })),
    })),
    denominator_unit: denominatorUnit,
    existing_columns: existingColumnNames,
  };

  const response = await fetch(`${OCR_SERVICE_URL}/v1/column-config/infer-all-columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM multi-group inference returned ${response.status}: ${text}`);
  }

  return response.json();
}

function buildColumnsFromLLM(
  llmColumns: LLMInferredColumn[],
  activityColumnName: string,
  dimCount: number,
  existingColumns: ColumnEntity[]
): DimColumnNames {
  const columns: ProposedColumn[] = [];

  for (let i = 0; i < dimCount; i++) {
    const llmCol = llmColumns.find((c) => c.position === i);
    const colName = llmCol?.suggested_name || `Dimension ${i + 1}`;
    const reuseName = llmCol?.reuse_existing;
    const existingCol = reuseName
      ? existingColumns.find((c) => c.column_name === reuseName)
      : existingColumns.find((c) => c.column_name.toLowerCase() === colName.toLowerCase());

    columns.push({
      existing_id: existingCol?.pk_id ?? null,
      column_name: existingCol?.column_name || colName,
      column_type: "select",
      is_new: !existingCol,
    });
  }

  const existingActivityCol = existingColumns.find(
    (c) => c.column_name.toLowerCase() === activityColumnName.toLowerCase()
  );
  columns.push({
    existing_id: existingActivityCol?.pk_id ?? null,
    column_name: existingActivityCol?.column_name || activityColumnName,
    column_type: "number",
    is_new: !existingActivityCol,
  });

  return { columns, activity_column_name: activityColumnName };
}

// ─── Config Building ────────────────────────────────────────────────────────

function makeOption(value: string): DropdownOptionValue {
  return { id: value, label: value };
}

function buildConfigGroup(
  parsed: ParsedEntry[],
  pattern: PatternType,
  dimensions: DimensionData[],
  denominatorUnit: string,
  allOriginalNames: string[],
  dominantColumns: DimColumnNames,
  columnNamesByDim: Record<number, DimColumnNames>,
  existingColumns: ColumnEntity[],
  source: "ecm" | "ef",
  efNamePairs?: EfNamePair[]
): ProposedConfigGroup {
  const columns = dominantColumns.columns;
  const columnOptions: ColumnOptionsMap = {};
  const columnDeps: ColumnDependencies = {};
  const depOptions: DependentOptionsMap = {};
  const ecMapping: EmissionCategoryMapping = {};

  // Extract column names for the pattern-specific builders
  const dimColumnNames = columns.filter((c) => c.column_type === "select").map((c) => c.column_name);

  // Build JSONB config fields based on pattern
  if (pattern === "FLAT") {
    buildFlatConfig(parsed, dimColumnNames, columnOptions, ecMapping);
  } else if (pattern === "TWO_DIM") {
    buildTwoDimConfig(
      parsed,
      dimColumnNames,
      columnOptions,
      columnDeps,
      depOptions,
      ecMapping
    );
  } else {
    buildThreeDimConfig(
      parsed,
      dimColumnNames,
      dimensions,
      columnOptions,
      columnDeps,
      depOptions,
      ecMapping
    );
  }

  return {
    denominator_unit: denominatorUnit,
    pattern,
    columns,
    column_options: columnOptions,
    column_dependencies: columnDeps,
    dependent_options: depOptions,
    emission_category_mapping: ecMapping,
    ef_names: allOriginalNames,
    ef_name_pairs: efNamePairs,
    source,
    column_names_by_dim: columnNamesByDim,
  };
}

// ─── Pattern-Specific Builders ──────────────────────────────────────────────

function buildFlatConfig(
  parsed: ParsedEntry[],
  dimColumnNames: string[],
  columnOptions: ColumnOptionsMap,
  ecMapping: EmissionCategoryMapping
) {
  const colName = dimColumnNames[0];

  // All values as dropdown options
  const uniqueVals = [...new Set(parsed.map((e) => e.parts[0]))].sort();
  columnOptions[colName] = uniqueVals.map(makeOption);

  // Identity mapping: value → original name
  for (const entry of parsed) {
    ecMapping[entry.parts[0]] = entry.original;
  }
}

function buildTwoDimConfig(
  parsed: ParsedEntry[],
  dimColumnNames: string[],
  columnOptions: ColumnOptionsMap,
  columnDeps: ColumnDependencies,
  depOptions: DependentOptionsMap,
  ecMapping: EmissionCategoryMapping
) {
  const col1Name = dimColumnNames[0];
  const col2Name = dimColumnNames[1];

  // Top-level options for dim0
  const dim0Vals = [...new Set(parsed.map((e) => e.parts[0]))].sort();
  columnOptions[col1Name] = dim0Vals.map(makeOption);

  // All dim1 values (for column_options - full list)
  const dim1Vals = [...new Set(parsed.filter((e) => e.parts.length >= 2).map((e) => e.parts[1]))].sort();
  columnOptions[col2Name] = dim1Vals.map(makeOption);

  // Dependency: col2 depends on col1
  columnDeps[col2Name] = col1Name;

  // Dependent options: per dim0 value → available dim1 values
  const dim1ByDim0 = new Map<string, Set<string>>();
  for (const entry of parsed) {
    if (entry.parts.length >= 2) {
      const d0 = entry.parts[0];
      const d1 = entry.parts[1];
      if (!dim1ByDim0.has(d0)) dim1ByDim0.set(d0, new Set());
      dim1ByDim0.get(d0)!.add(d1);
    }
  }
  depOptions[col2Name] = {};
  for (const [parentVal, childVals] of dim1ByDim0) {
    depOptions[col2Name][parentVal] = [...childVals].sort().map(makeOption);
  }

  // Emission category mapping: "dim0|dim1" → original name
  for (const entry of parsed) {
    if (entry.parts.length >= 2) {
      const key = `${entry.parts[0]}|${entry.parts[1]}`;
      ecMapping[key] = entry.original;
    }
  }
}

function buildThreeDimConfig(
  parsed: ParsedEntry[],
  dimColumnNames: string[],
  dimensions: DimensionData[],
  columnOptions: ColumnOptionsMap,
  columnDeps: ColumnDependencies,
  depOptions: DependentOptionsMap,
  ecMapping: EmissionCategoryMapping
) {
  const col1Name = dimColumnNames[0];
  const col2Name = dimColumnNames[1];
  const col3Name = dimColumnNames[2];

  // Top-level options for all dimensions
  columnOptions[col1Name] = dimensions[0].values.map(makeOption);
  columnOptions[col2Name] = dimensions[1].values.map(makeOption);
  columnOptions[col3Name] = dimensions[2].values.map(makeOption);

  // Chain dependencies: col2→col1, col3→col2
  columnDeps[col2Name] = col1Name;
  columnDeps[col3Name] = col2Name;

  // Dependent options: col2 values per col1 value
  const dim1ByDim0 = new Map<string, Set<string>>();
  for (const entry of parsed) {
    if (entry.parts.length >= 2) {
      const d0 = entry.parts[0];
      const d1 = entry.parts[1];
      if (!dim1ByDim0.has(d0)) dim1ByDim0.set(d0, new Set());
      dim1ByDim0.get(d0)!.add(d1);
    }
  }
  depOptions[col2Name] = {};
  for (const [parentVal, childVals] of dim1ByDim0) {
    depOptions[col2Name][parentVal] = [...childVals].sort().map(makeOption);
  }

  // Dependent options: col3 values per col2 value
  const dim2ByDim1 = new Map<string, Set<string>>();
  for (const entry of parsed) {
    if (entry.parts.length >= 3) {
      const d1 = entry.parts[1];
      const d2 = entry.parts[2];
      if (!dim2ByDim1.has(d1)) dim2ByDim1.set(d1, new Set());
      dim2ByDim1.get(d1)!.add(d2);
    }
  }
  depOptions[col3Name] = {};
  for (const [parentVal, childVals] of dim2ByDim1) {
    depOptions[col3Name][parentVal] = [...childVals].sort().map(makeOption);
  }

  // Emission category mapping: "dim0|dim1|dim2" → original name
  for (const entry of parsed) {
    if (entry.parts.length >= 3) {
      const key = `${entry.parts[0]}|${entry.parts[1]}|${entry.parts[2]}`;
      ecMapping[key] = entry.original;
    }
  }
}
