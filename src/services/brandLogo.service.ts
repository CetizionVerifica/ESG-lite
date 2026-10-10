// Brand logo persistence: upload the image to R2 and point the company's brand
// row at it. Shared by the brand controller (POST /brands/:companyId/logo) and
// company onboarding, which accepts a logo in the same multipart payload.
import { AppDataSource } from "../config/data-source";
import { Brand } from "../entities/Brand";
import { uploadToR2, r2Enabled, brandLogoKey, brandDarkLogoKey, brandGuidelineKey } from "../config/r2";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export const SUPPORTED_LOGO_MIMES = Object.keys(EXT_BY_MIME);

export const isSupportedLogoMime = (mimetype: string): boolean =>
  mimetype in EXT_BY_MIME;

export const isAssetStorageConfigured = (): boolean => r2Enabled();

interface LogoFile {
  buffer: Buffer;
  mimetype: string;
}

/**
 * Uploads `file` to R2 under a deterministic per-company key and upserts the
 * brand row with the resulting public URL. `variant: "dark"` stores the logo
 * for dark surfaces (logo_on_dark_url) instead of the main logo. Callers must check
 * `isSupportedLogoMime` and `isAssetStorageConfigured` first.
 */
export const saveCompanyLogo = async (
  companyId: number,
  companyName: string,
  file: LogoFile,
  variant: "default" | "dark" = "default"
): Promise<Brand> => {
  const ext = EXT_BY_MIME[file.mimetype] || "png";
  const key = variant === "dark" ? brandDarkLogoKey(companyId, ext) : brandLogoKey(companyId, ext);
  const { url } = await uploadToR2(file.buffer, key, file.mimetype);

  const repo = AppDataSource.getRepository(Brand);
  const existing = await repo.findOne({ where: { companyId } });
  const brand = existing || repo.create({ companyId, name: companyName });

  return repo.save(
    variant === "dark"
      ? { ...brand, logoOnDarkUrl: url, logoOnDarkPublicId: key }
      : { ...brand, logoUrl: url, logoPublicId: key }
  );
};

// Colour guidelines arrive as a PDF or an image of the brand sheet.
const GUIDELINE_EXT_BY_MIME: Record<string, string> = { "application/pdf": "pdf", ...EXT_BY_MIME };

export const SUPPORTED_GUIDELINE_MIMES = Object.keys(GUIDELINE_EXT_BY_MIME);

export const isSupportedGuidelineMime = (mimetype: string): boolean =>
  mimetype in GUIDELINE_EXT_BY_MIME;

/**
 * Uploads a colour-guideline file to R2 and upserts the brand row with its URL
 * and original name. Callers must check `isSupportedGuidelineMime` and
 * `isAssetStorageConfigured` first.
 */
export const saveCompanyGuideline = async (
  companyId: number,
  companyName: string,
  file: LogoFile & { originalname?: string }
): Promise<Brand> => {
  const key = brandGuidelineKey(companyId, GUIDELINE_EXT_BY_MIME[file.mimetype] || "pdf");
  const { url } = await uploadToR2(file.buffer, key, file.mimetype);

  const repo = AppDataSource.getRepository(Brand);
  const existing = await repo.findOne({ where: { companyId } });
  const brand = existing || repo.create({ companyId, name: companyName });

  // The key is reused on replace and R2 serves it as immutable, so the version
  // parameter makes a replaced file show up instead of a cached old one.
  return repo.save({ ...brand, guidelineUrl: `${url}?v=${Date.now()}`, guidelinePublicId: key, guidelineName: file.originalname || null });
};
