// One-time migration: import local brand-assets/<companyId>/ into the `brand`
// table + Cloudinary. Run once when moving from local files to production.
//
//   npx ts-node src/scripts/seed-brands.ts
//
// Idempotent: re-running updates existing rows and overwrites the Cloudinary
// logo (fixed public_id company_<id>). Safe to run repeatedly.
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

async function main() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Brand);

  if (!existsSync(DIR)) {
    console.log("No brand-assets/ directory — nothing to migrate.");
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
