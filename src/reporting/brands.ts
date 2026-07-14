// Loads a client's brand kit for report rendering.
//
// Production source of truth = the `brand` table (colors + Cloudinary logo URL).
// The report renderer needs the logo inlined as a data URL, so a Cloudinary
// logo is fetched once and base64-embedded (cached in-process by URL).
//
// Falls back, in order: DB row → local brand-assets/<companyId>/ (dev) →
// built-in defaults. This keeps existing local development working while the
// DB/Cloudinary path is the deployable one.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Theme } from "./types";
import { AppDataSource } from "../config/data-source";
import { Brand } from "../entities/Brand";

const DIR = join(process.cwd(), "brand-assets");
const strip = (s: string) => s.replace(/^﻿/, "");

interface BrandKit {
  name: string;
  primary: string;
  accent: string;
  coverBgFrom: string;
  coverBgTo: string;
}

const DEFAULTS: BrandKit = {
  name: "",
  primary: "#1f2a44",
  accent: "#3b82f6",
  coverBgFrom: "#0d1526",
  coverBgTo: "#1f2a44",
};

// Cache embedded logos by source URL so we don't re-download Cloudinary on
// every render. Cleared on process restart (fine for logo changes: rare).
const logoCache = new Map<string, string>();

async function embedRemoteLogo(url: string, alt: string): Promise<string | undefined> {
  const cached = logoCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const mime = res.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    const tag = `<img alt="${alt}" src="data:${mime};base64,${buf.toString("base64")}">`;
    logoCache.set(url, tag);
    return tag;
  } catch {
    return undefined;
  }
}

function readLocalLogo(companyId: number, name: string): string | undefined {
  const dir = join(DIR, String(companyId));
  const svg = join(dir, "logo.svg");
  if (existsSync(svg)) return strip(readFileSync(svg, "utf8"));
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const p = join(dir, `logo.${ext}`);
    if (existsSync(p)) {
      const mime = ext === "jpg" ? "jpeg" : ext;
      return `<img alt="${name}" src="data:image/${mime};base64,${readFileSync(p).toString("base64")}">`;
    }
  }
  return undefined;
}

function readLocalTheme(companyId: number): Partial<BrandKit> | null {
  const tf = join(DIR, String(companyId), "theme.json");
  if (!existsSync(tf)) return null;
  try {
    return JSON.parse(strip(readFileSync(tf, "utf8")));
  } catch {
    return null;
  }
}

async function loadBrand(companyId: number): Promise<Brand | null> {
  if (!AppDataSource.isInitialized) return null;
  try {
    return await AppDataSource.getRepository(Brand).findOne({ where: { companyId } });
  } catch {
    return null;
  }
}

export async function getBrandTheme(companyId: number, companyName: string): Promise<Theme> {
  const row = await loadBrand(companyId);

  // Colors: DB row wins, then local theme.json (dev), then defaults.
  const local = readLocalTheme(companyId);
  const kit: BrandKit = {
    ...DEFAULTS,
    name: companyName,
    ...(local ?? {}),
    ...(row
      ? {
          name: row.name || companyName,
          primary: row.primary,
          accent: row.accent,
          coverBgFrom: row.coverFrom,
          coverBgTo: row.coverTo,
        }
      : {}),
  };

  // Logo: Cloudinary URL from the DB row (embedded), else local file (dev).
  let logoSvg: string | undefined;
  if (row?.logoUrl) logoSvg = await embedRemoteLogo(row.logoUrl, kit.name);
  if (!logoSvg) logoSvg = readLocalLogo(companyId, kit.name);

  return {
    id: `co-${companyId}`,
    name: kit.name,
    logoSvg,
    page: { size: "A4", margin: "18mm 16mm 18mm 16mm" },
    colors: {
      primary: kit.primary, accent: kit.accent, ink: "#101828", muted: "#667085",
      surface: "#F5F7FA", border: "#E4E9F0", onPrimary: "#FFFFFF",
      coverBgFrom: kit.coverBgFrom, coverBgTo: kit.coverBgTo,
    },
    chartPalette: [kit.accent, kit.primary, "#8db0d4", "#255789", "#c1d4e7", "#09254a"],
    fonts: { heading: "'Segoe UI Semibold','Segoe UI',Arial,sans-serif", body: "'Segoe UI',Arial,sans-serif" },
    footer: `Confidential — prepared for ${kit.name}`,
  };
}
