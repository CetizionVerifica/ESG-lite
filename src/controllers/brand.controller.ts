import { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Brand } from "../entities/Brand";
import { Company } from "../entities/Company";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  saveCompanyLogo,
  isSupportedLogoMime,
  isAssetStorageConfigured,
  SUPPORTED_LOGO_MIMES,
} from "../services/brandLogo.service";

const brandRepo = () => AppDataSource.getRepository(Brand);
const companyRepo = () => AppDataSource.getRepository(Company);

const HEX = /^#[0-9a-fA-F]{6}$/;

// GET /brands/:companyId — current brand kit (falls back to company name/defaults)
export const getBrand = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = Number(req.params.companyId);
    if (!companyId) return res.status(400).json({ message: "companyId required" });

    const brand = await brandRepo().findOne({ where: { companyId } });
    if (brand) return res.status(200).json(brand);

    const company = await companyRepo().findOne({ where: { company_id: companyId } });
    if (!company) return res.status(404).json({ message: "Company not found" });
    return res.status(200).json({
      companyId,
      name: company.name,
      primary: "#1f2a44",
      accent: "#3b82f6",
      coverFrom: "#0d1526",
      coverTo: "#1f2a44",
      logoUrl: null,
      logoPublicId: null,
    });
  } catch (error) {
    console.error("Get brand error:", error);
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

    const { name, primary, accent, coverFrom, coverTo } = req.body;
    for (const [k, v] of Object.entries({ primary, accent, coverFrom, coverTo })) {
      if (v !== undefined && !HEX.test(String(v))) {
        return res.status(400).json({ message: `${k} must be a 6-digit hex color like #1f2a44` });
      }
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

    await repo.save(brand);
    return res.status(200).json({ message: "Brand saved", brand });
  } catch (error) {
    console.error("Upsert brand error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /brands/:companyId/logo — multipart "logo" file → Cloudinary
export const uploadBrandLogo = async (req: AuthRequest, res: Response) => {
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

    const brand = await saveCompanyLogo(companyId, company.name, file);

    return res.status(200).json({ message: "Logo uploaded", brand });
  } catch (error) {
    console.error("Upload brand logo error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
