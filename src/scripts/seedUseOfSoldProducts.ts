// Activates Scope 3 Category 11 "Use of sold products" (category_id 20) for the
// given sites by seeding everything the data-entry form needs:
//
//   1. Global columns (reused by exact name if they already exist):
//      Method (select), Product Name (text), Country / Fuel / Gas (select),
//      Units Sold, Energy per Use (kWh), Lifetime Uses, Gas per Product (kg),
//      % of Gas Released (all number).
//   2. One column config per site with the Method -> Country/Fuel/Gas cascading
//      dropdown, the label-chain -> factor-name mapping, and the per-method
//      CALCULATION SPEC (multi-field multiplication — the new mechanism).
//   3. Unit rows: kWh, litre, kg.
//   4. Emission factors per country/fuel/gas for years 2024 and 2025 (the
//      factor-year rule looks up year N-1, so 2025/2026 entries both resolve).
//
//   npx ts-node src/scripts/seedUseOfSoldProducts.ts            # default sites 27 (Noida) + 24 (Chieron)
//   npx ts-node src/scripts/seedUseOfSoldProducts.ts 23         # specific site id(s)
//
// Idempotent: safe to re-run. It never deletes anything — existing rows are
// found and reused; the config row is updated in place if it already exists.
// NOTE: it does NOT assign category 20 to any site (site_categories) — that is
// a deliberate Superadmin action (Sites page -> edit site -> tick the category).
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { ColumnEntity } from "../entities/Column";
import { ColumnConfig, CalculationSpec } from "../entities/ColumnConfig";
import { EmissionFactor } from "../entities/EmissionFactor";
import { Unit } from "../entities/Unit";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";

const CATEGORY_ID = 20;
const DEFAULT_SITE_IDS = [27, 24]; // Noida, Chieron - Main Site
const CONFIG_NAME = "Use of Sold Products - Standard";

// Method dropdown: option id === label (same convention as the transport
// categories), so activity_data, dependent_options keys, and the calculation
// spec all use the one string and nothing needs id->label conversion.
const METHOD_ENERGY = "Product that uses energy";
const METHOD_FUEL = "Fuel sold to customers";
const METHOD_GAS = "Product containing gas";

const COLUMNS: Array<{ name: string; type: string }> = [
  { name: "Method", type: "select" },
  { name: "Product Name", type: "text" },
  { name: "Country / Fuel / Gas", type: "select" },
  { name: "Units Sold", type: "number" },
  { name: "Energy per Use (kWh)", type: "number" },
  { name: "Lifetime Uses", type: "number" },
  { name: "Gas per Product (kg)", type: "number" },
  { name: "% of Gas Released", type: "number" },
];

const DEPENDENT_OPTIONS: Record<string, string[]> = {
  [METHOD_ENERGY]: ["Germany", "Denmark", "Netherlands", "India"],
  [METHOD_FUEL]: ["Petrol", "Diesel"],
  [METHOD_GAS]: ["R134a", "R410A"],
};

const EMISSION_CATEGORY_MAPPING: Record<string, string> = {
  [`${METHOD_ENERGY}|Germany`]: "Grid Mix Germany",
  [`${METHOD_ENERGY}|Denmark`]: "Grid Mix Denmark",
  [`${METHOD_ENERGY}|Netherlands`]: "Grid Mix Netherlands",
  [`${METHOD_ENERGY}|India`]: "Grid Mix India",
  [`${METHOD_FUEL}|Petrol`]: "Petrol - Combustion",
  [`${METHOD_FUEL}|Diesel`]: "Diesel - Combustion",
  [`${METHOD_GAS}|R134a`]: "R134a - GWP",
  [`${METHOD_GAS}|R410A`]: "R410A - GWP",
};

const CALCULATION: CalculationSpec = {
  mode: "per_method",
  method_column: "Method",
  identity_columns: ["Product Name"],
  methods: {
    // GHG Protocol formula 11.1: lifetime uses x number sold x kWh per use x grid EF
    [METHOD_ENERGY]: {
      multiply: ["Units Sold", "Energy per Use (kWh)", "Lifetime Uses"],
      activity_unit: "kWh",
    },
    // Formula 11.2: quantity of fuel sold x combustion EF ("Units Sold" = litres sold)
    [METHOD_FUEL]: {
      multiply: ["Units Sold"],
      activity_unit: "litre",
    },
    // Formula 11.3: GHG per product x number sold x % released x GWP
    [METHOD_GAS]: {
      multiply: ["Units Sold", "Gas per Product (kg)", "% of Gas Released"],
      percent: ["% of Gas Released"],
      activity_unit: "kg",
    },
  },
};

const UNITS = ["kWh", "litre", "kg"];

// factor_value is kg CO2e per denominator_unit (the engine divides by 1000 to
// report tCO2e). Grid values are the ones from the boss's Luqom reference.
const FACTOR_YEARS = [2024, 2025];
const FACTORS: Array<{ name: string; value: number; unit: string; source: string }> = [
  { name: "Grid Mix Germany", value: 0.349, unit: "kwh", source: "IEA (Luqom reference)" },
  { name: "Grid Mix Denmark", value: 0.057, unit: "kwh", source: "IEA (Luqom reference)" },
  { name: "Grid Mix Netherlands", value: 0.28, unit: "kwh", source: "IEA (Luqom reference)" },
  { name: "Grid Mix India", value: 0.713, unit: "kwh", source: "IEA" },
  { name: "Petrol - Combustion", value: 2.31, unit: "litre", source: "DEFRA" },
  { name: "Diesel - Combustion", value: 2.68, unit: "litre", source: "DEFRA" },
  { name: "R134a - GWP", value: 1430, unit: "kg", source: "IPCC AR4 GWP100" },
  { name: "R410A - GWP", value: 2088, unit: "kg", source: "IPCC AR4 GWP100" },
];

async function main() {
  const siteIds = process.argv.slice(2).map(Number).filter((n) => !isNaN(n));
  const targets = siteIds.length > 0 ? siteIds : DEFAULT_SITE_IDS;

  await AppDataSource.initialize();
  const columnRepo = AppDataSource.getRepository(ColumnEntity);
  const configRepo = AppDataSource.getRepository(ColumnConfig);
  const factorRepo = AppDataSource.getRepository(EmissionFactor);
  const unitRepo = AppDataSource.getRepository(Unit);
  const siteRepo = AppDataSource.getRepository(Site);
  const categoryRepo = AppDataSource.getRepository(Category);

  const category = await categoryRepo.findOne({ where: { category_id: CATEGORY_ID } });
  if (!category) throw new Error(`Category ${CATEGORY_ID} not found`);
  console.log(`Category ${CATEGORY_ID}: ${category.category_name}`);

  // 1. Global columns (find by exact name, create if missing)
  const columnByName = new Map<string, ColumnEntity>();
  for (const col of COLUMNS) {
    let entity = await columnRepo.findOne({ where: { column_name: col.name } });
    if (!entity) {
      entity = await columnRepo.save(columnRepo.create({ column_name: col.name, column_type: col.type }));
      console.log(`  column created: "${col.name}" (${col.type}) pk ${entity.pk_id}`);
    } else {
      console.log(`  column reused:  "${col.name}" pk ${entity.pk_id}`);
    }
    columnByName.set(col.name, entity);
  }

  const methodCol = columnByName.get("Method")!;
  const columnOptions = {
    [String(methodCol.pk_id)]: [METHOD_ENERGY, METHOD_FUEL, METHOD_GAS].map((m) => ({ id: m, label: m })),
  };
  const dependentOptions = {
    "Country / Fuel / Gas": Object.fromEntries(
      Object.entries(DEPENDENT_OPTIONS).map(([parent, opts]) => [
        parent,
        opts.map((o) => ({ id: o, label: o })),
      ]),
    ),
  };

  for (const site_id of targets) {
    const site = await siteRepo.findOne({ where: { site_id } });
    if (!site) {
      console.warn(`site ${site_id} not found — skipped`);
      continue;
    }
    console.log(`\nSite ${site_id} (${site.name}):`);

    // 2. Column config (update in place when it already exists)
    let config = await configRepo.findOne({
      where: { config_name: CONFIG_NAME, site: { site_id }, category: { category_id: CATEGORY_ID } },
      relations: ["site", "category", "columns"],
    });
    if (!config) {
      config = configRepo.create({
        config_name: CONFIG_NAME,
        site: { site_id } as Site,
        category: { category_id: CATEGORY_ID } as Category,
      });
    }
    config.columns = COLUMNS.map((c) => columnByName.get(c.name)!);
    config.column_options = columnOptions;
    config.column_dependencies = { "Country / Fuel / Gas": "Method" };
    config.dependent_options = dependentOptions;
    config.emission_category_mapping = EMISSION_CATEGORY_MAPPING;
    config.extra_fields = config.extra_fields ?? [];
    config.calculation = CALCULATION;
    await configRepo.save(config);
    console.log(`  config "${CONFIG_NAME}" saved (pk ${config.pk_id})`);

    // 3. Units
    for (const unitName of UNITS) {
      const existing = await unitRepo.findOne({
        where: { unit_name: unitName, site: { site_id }, category: { category_id: CATEGORY_ID } },
        relations: ["site", "category"],
      });
      if (!existing) {
        await unitRepo.save(
          unitRepo.create({
            unit_name: unitName,
            description: "Use of Sold Products",
            site: { site_id } as Site,
            category: { category_id: CATEGORY_ID } as Category,
          }),
        );
        console.log(`  unit created: ${unitName}`);
      }
    }

    // 4. Factors for both years
    for (const year of FACTOR_YEARS) {
      for (const f of FACTORS) {
        const existing = await factorRepo.findOne({
          where: {
            site: { site_id },
            category: { category_id: CATEGORY_ID },
            year,
            emission_category_name: f.name,
          },
          relations: ["site", "category"],
        });
        if (!existing) {
          await factorRepo.save(
            factorRepo.create({
              site: { site_id } as Site,
              category: { category_id: CATEGORY_ID } as Category,
              year,
              factor_value: f.value,
              denominator_unit: f.unit,
              source: f.source,
              emission_category_name: f.name,
              global_category_name: f.name,
            }),
          );
          console.log(`  factor created: ${f.name} ${year} = ${f.value} kg CO2e/${f.unit}`);
        }
      }
    }
  }

  await AppDataSource.destroy();
  console.log("\nDone. Remember: sites still need the category ASSIGNED (Superadmin -> Sites -> edit).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
