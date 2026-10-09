import { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Brand, BRAND_LOOKS } from "../entities/Brand";
import { Company } from "../entities/Company";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  saveCompanyLogo,
  isSupportedLogoMime,
  isAssetStorageConfigured,
  SUPPORTED_LOGO_MIMES,
} from "../services/brandLogo.service";
import { resolveUserCompanyId } from "../utils/companyScope";
import { UserRole } from "../types/type";

const brandRepo = () => AppDataSource.getRepository(Brand);
const companyRepo = () => AppDataSource.getRepository(Company);

const HEX = /^#[0-9a-fA-F]{6}$/;

// Brand kit for a company: its brand row, or the defaults under the company's
// name when no row exists yet. Null when the company does not exist.
const loadBrandOrDefaults = async (companyId: number) => {
  const brand = await brandRepo().findOne({ where: { companyId } });
  if (brand) return brand;

  const company = await companyRepo().findOne({ where: { company_id: companyId } });
  if (!company) return null;
  return {
    companyId,
    name: company.name,
    primary: "#1f2a44",
    accent: "#3b82f6",
    coverFrom: "#0d1526",
    coverTo: "#1f2a44",
    logoUrl: null,
    logoPublicId: null,
    logoOnDarkUrl: null,
    logoOnDarkPublicId: null,
    defaultLook: "classic",
    scope3Colour: null,
  };
};

// GET /brands/:companyId — current brand kit (falls back to company name/defaults).
// Superadmins read any company. Everyone else reads only their own company's
// kit, without the storage keys, so Managers, Users and company Admins can
// theme the app.
export const getBrand = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = Number(req.params.companyId);
    if (!companyId) return res.status(400).json({ message: "companyId required" });

    const isSuperAdmin = req.user?.role === UserRole.SUPERADMIN;
    if (!isSuperAdmin) {
      const ownCompanyId = req.user?.userId ? await resolveUserCompanyId(req.user.userId) : null;
      if (ownCompanyId !== companyId) return res.status(403).json({ message: "Access denied" });
    }

    const brand = await loadBrandOrDefaults(companyId);
    if (!brand) return res.status(404).json({ message: "Company not found" });
    if (isSuperAdmin) return res.status(200).json(brand);
    const { logoPublicId, logoOnDarkPublicId, ...kit } = brand as any;
    return res.status(200).json(kit);
  } catch (error) {
    console.error("Get brand error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /brands/mine — read-only brand kit of the signed-in user's own company,
// so the app can theme itself without knowing the company id. 404 when the
// user has no company (e.g. Superadmin), in which case the app uses the
// PlanetPulse defaults.
export const getMyBrand = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const companyId = await resolveUserCompanyId(userId);
    if (!companyId) return res.status(404).json({ message: "No company for this user" });

    const brand = await loadBrandOrDefaults(companyId);
    if (!brand) return res.status(404).json({ message: "Company not found" });
    const { logoPublicId, logoOnDarkPublicId, ...kit } = brand as any;
    return res.status(200).json(kit);
  } catch (error) {
    console.error("Get my brand error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /brands/:companyId — upsert name + colors (JSON body)
export const upsertBrand = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = Number(req.params.companyId);
    if (!companyId) return res.status(400).json({ message: "companyId required" });

    const company = await companyRepo().findOne({ where: { company_id: companyId } });
    if (!company) return res.status(404).json({ message: "Company not found" });

    const { name, primary, accent, coverFrom, coverTo, defaultLook, scope3Colour, logoOnDarkUrl } = req.body;
    for (const [k, v] of Object.entries({ primary, accent, coverFrom, coverTo })) {
      if (v !== undefined && !HEX.test(String(v))) {
        return res.status(400).json({ message: `${k} must be a 6-digit hex color like #1f2a44` });
      }
    }
    if (scope3Colour !== undefined && scope3Colour !== null && !HEX.test(String(scope3Colour))) {
      return res.status(400).json({ message: "scope3Colour must be a 6-digit hex color like #1f2a44, or null" });
    }
    if (defaultLook !== undefined && !(BRAND_LOOKS as readonly string[]).includes(defaultLook)) {
      return res.status(400).json({ message: `defaultLook must be one of ${BRAND_LOOKS.join(", ")}` });
    }
    // The dark logo is set by upload only; null removes it.
    if (logoOnDarkUrl !== undefined && logoOnDarkUrl !== null) {
      return res.status(400).json({ message: "logoOnDarkUrl can only be cleared (null); upload via POST /brands/:companyId/logo-dark" });
    }

    const repo = brandRepo();
    let brand = await repo.findOne({ where: { companyId } });
    if (!brand) {
      brand = repo.create({ companyId, name: name || company.name });
    }
    if (name !== undefined) brand.name = name;
    if (primary !== undefined) brand.primary = primary;
    if (accent !== undefined) brand.accent = accent;
    if (coverFrom !== undefined) brand.coverFrom = coverFrom;
    if (coverTo !== undefined) brand.coverTo = coverTo;
    if (defaultLook !== undefined) brand.defaultLook = defaultLook;
    if (scope3Colour !== undefined) brand.scope3Colour = scope3Colour;
    if (logoOnDarkUrl === null) {
      brand.logoOnDarkUrl = null;
      brand.logoOnDarkPublicId = null;
    }

    await repo.save(brand);
    return res.status(200).json({ message: "Brand saved", brand });
  } catch (error) {
    console.error("Upsert brand error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /brands/:companyId/logo — multipart "logo" file → R2
export const uploadBrandLogo = (req: AuthRequest, res: Response) =>
  handleLogoUpload(req, res, "default");

// POST /brands/:companyId/logo-dark — multipart "logo" file → R2, stored as
// the logo for dark surfaces (logoOnDarkUrl)
export const uploadBrandDarkLogo = (req: AuthRequest, res: Response) =>
  handleLogoUpload(req, res, "dark");

const handleLogoUpload = async (req: AuthRequest, res: Response, variant: "default" | "dark") => {
  try {
    const companyId = Number(req.params.companyId);
    if (!companyId) return res.status(400).json({ message: "companyId required" });

    const file = req.file;
    if (!file) return res.status(400).json({ message: "No logo uploaded (field name: logo)" });
    if (!isSupportedLogoMime(file.mimetype)) {
      return res.status(400).json({
        message: `Logo must be an image (${SUPPORTED_LOGO_MIMES.join(", ")})`,
      });
    }

    const company = await companyRepo().findOne({ where: { company_id: companyId } });
    if (!company) return res.status(404).json({ message: "Company not found" });

    if (!isAssetStorageConfigured()) {
      return res.status(503).json({ message: "Asset storage (R2) is not configured on the server" });
    }

    const brand = await saveCompanyLogo(companyId, company.name, file, variant);

    return res.status(200).json({ message: "Logo uploaded", brand });
  } catch (error) {
    console.error("Upload brand logo error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
