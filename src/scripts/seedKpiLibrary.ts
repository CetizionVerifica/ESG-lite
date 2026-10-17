// KPI-2 · loads the KPI library seed from data/kpi/ (frameworks, KPI
// definitions, disclosures per framework version, mappings):
//
//   npm run migrate:kpi-library-seed        (after migrate:kpi-library)
//
// Idempotent: adds missing rows, refreshes rows no Superadmin has edited
// (edited_at null) to the seed's content, keeps edited rows as they are and
// never deletes anything. Refuses a seed that fails its integrity check
// (src/kpi/library/seed.ts seedProblems). Runs in one transaction.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { applySeed, readSeed, seedProblems } from "../kpi/library/seed";

async function main() {
  const seed = readSeed();
  const problems = seedProblems(seed);
  if (problems.length) {
    console.error(`The KPI library seed has ${problems.length} problem(s); nothing was loaded:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  await AppDataSource.initialize();
  try {
    const result = await AppDataSource.transaction((m) => applySeed(m, seed));
    const line = (Object.keys(result) as Array<keyof typeof result>)
      .map((k) => `${k}: +${result[k].added}, refreshed ${result[k].refreshed}, kept ${result[k].kept_edited} edited`)
      .join("; ");
    console.log(`KPI library seed loaded (${line}).`);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
