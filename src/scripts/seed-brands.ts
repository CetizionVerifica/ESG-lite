// Sets up per-client branding on ANY database in ONE run:
//   1. Creates the `brand` table if it doesn't exist (safe, idempotent DDL in a
//      transaction — touches ONLY this table; required in production, where
//      TypeORM auto-sync is off).
//   2. Imports local brand-assets/<companyId>/ into the table and uploads each
//      logo to Cloudflare R2.
//
//   npx ts-node src/scripts/seed-brands.ts                # table + data (default)
//   npx ts-node src/scripts/seed-brands.ts --schema-only  # just create the table
//   npx ts-node src/scripts/seed-brands.ts --seed-only     # skip table creation
//
// Idempotent and safe to re-run: rows are upserted and logos overwritten at a
// fixed key. It never drops or alters existing data or other tables.
import "reflect-metadata";
import { readdirSync, existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { AppDataSource } from "../config/data-source";
import { Brand } from "../entities/Brand";
import { uploadToR2, r2Enabled, brandLogoKey } from "../config/r2";

const DIR = join(process.cwd(), "brand-assets");
const strip = (s: string) => s.replace(/^﻿/, "");

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml",
};

function findLogo(dir: string): { buf: Buffer; ext: string } | null {
  for (const ext of ["png", "jpg", "jpeg", "webp", "svg"]) {
    const p = join(dir, `logo.${ext}`);
    if (existsSync(p)) return { buf: readFileSync(p), ext };
  }
  return null;
}

// Exact schema for the Brand entity. IF NOT EXISTS + a transaction makes this
// safe to run against production: it never touches another table or existing
// rows. `primary` is a reserved word, so it is quoted (as TypeORM does).
const CREATE_BRAND_TABLE = `
CREATE TABLE IF NOT EXISTS brand (
  company_id      integer PRIMARY KEY,
  name            varchar NOT NULL,
  "primary"       varchar NOT NULL DEFAULT '#1f2a44',
  accent          varchar NOT NULL DEFAULT '#3b82f6',
  cover_from      varchar NOT NULL DEFAULT '#0d1526',
  cover_to        varchar NOT NULL DEFAULT '#1f2a44',
  logo_url        varchar,
  logo_public_id  varchar,
  logo_on_dark_url       varchar,
  logo_on_dark_public_id varchar,
  default_look    varchar(10) NOT NULL DEFAULT 'classic',
  scope3_colour   varchar,
  updated_at      timestamp NOT NULL DEFAULT now()
)`;

async function ensureBrandTable() {
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  try {
    await qr.startTransaction();
    await qr.query(CREATE_BRAND_TABLE);
    await qr.commitTransaction();
    console.log("✓ brand table ready (created if it did not exist)");
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
  }
}

async function main() {
  const schemaOnly = process.argv.includes("--schema-only");
  const seedOnly = process.argv.includes("--seed-only");

  await AppDataSource.initialize();

  if (process.env.NODE_ENV === "production" && (AppDataSource.options as any).synchronize) {
    console.warn(
      "⚠ TYPEORM_SYNC is ON in production — connecting may alter other tables. Set TYPEORM_SYNC=false and re-run."
    );
  }

  if (!seedOnly) await ensureBrandTable();
  if (schemaOnly) {
    console.log("Schema-only mode — table is ready; skipping data seed.");
    await AppDataSource.destroy();
    return;
  }

  const repo = AppDataSource.getRepository(Brand);

  if (!existsSync(DIR)) {
    console.log(
      "No brand-assets/ directory — table is ready. Populate via the Brand Settings UI, or re-run where brand-assets/ exists."
    );
    await AppDataSource.destroy();
    return;
  }

  const folders = readdirSync(DIR).filter((f) => statSync(join(DIR, f)).isDirectory() && /^\d+$/.test(f));
  console.log(`Found ${folders.length} brand folder(s): ${folders.join(", ")}`);

  for (const folder of folders) {
    const companyId = Number(folder);
    const dir = join(DIR, folder);

    let kit: any = {};
    const tf = join(dir, "theme.json");
    if (existsSync(tf)) {
      try { kit = JSON.parse(strip(readFileSync(tf, "utf8"))); } catch { /* ignore */ }
    }

    let brand = await repo.findOne({ where: { companyId } });
    if (!brand) brand = repo.create({ companyId, name: kit.name || `Company ${companyId}` });
    if (kit.name) brand.name = kit.name;
    if (kit.primary) brand.primary = kit.primary;
    if (kit.accent) brand.accent = kit.accent;
    if (kit.coverBgFrom) brand.coverFrom = kit.coverBgFrom;
    if (kit.coverBgTo) brand.coverTo = kit.coverBgTo;

    const logo = findLogo(dir);
    if (logo && r2Enabled()) {
      try {
        const ext = logo.ext === "jpeg" ? "jpg" : logo.ext;
        const key = brandLogoKey(companyId, ext);
        const { url } = await uploadToR2(logo.buf, key, MIME_BY_EXT[logo.ext] || "image/png");
        brand.logoUrl = url;
        brand.logoPublicId = key;
        console.log(`  #${companyId} ${brand.name}: logo → ${url}`);
      } catch (e: any) {
        console.warn(`  #${companyId} logo upload failed: ${e?.message || e}`);
      }
    } else if (logo) {
      console.warn(`  #${companyId} ${brand.name}: R2 not configured — skipping logo upload`);
    } else {
      console.log(`  #${companyId} ${brand.name}: no logo file`);
    }

    await repo.save(brand);
    console.log(`  #${companyId} ${brand.name}: saved (${brand.primary}/${brand.accent})`);
  }

  await AppDataSource.destroy();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
