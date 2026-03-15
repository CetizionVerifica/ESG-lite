import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { ColumnConfig } from "../entities/ColumnConfig";
import { getDefaultExtraFields } from "../utils/defaultExtraFields";

async function seedExtraFields() {
  await AppDataSource.initialize();
  console.log("Database connected.");

  const repo = AppDataSource.getRepository(ColumnConfig);
  const configs = await repo.find({ relations: ["category"] });

  let updated = 0;
  let skipped = 0;

  for (const config of configs) {
    const categoryId = config.category?.category_id;
    if (!categoryId) {
      skipped++;
      continue;
    }

    // Skip configs that already have extra_fields populated
    if (config.extra_fields && Array.isArray(config.extra_fields) && config.extra_fields.length > 0) {
      console.log(`  Skipped: config ${config.pk_id} (category ${categoryId}) — already has ${config.extra_fields.length} fields`);
      skipped++;
      continue;
    }

    const defaults = getDefaultExtraFields(categoryId);
    if (defaults.length === 0) {
      console.log(`  Skipped: config ${config.pk_id} (category ${categoryId}) — no defaults defined`);
      skipped++;
      continue;
    }

    config.extra_fields = defaults;
    await repo.save(config);
    console.log(`  Updated: config ${config.pk_id} (category ${categoryId}) — ${defaults.length} fields`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}, Total: ${configs.length}`);
  process.exit(0);
}

seedExtraFields().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
