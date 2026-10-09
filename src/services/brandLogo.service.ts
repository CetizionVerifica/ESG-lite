// Brand logo persistence: upload the image to R2 and point the company's brand
// row at it. Shared by the brand controller (POST /brands/:companyId/logo) and
// company onboarding, which accepts a logo in the same multipart payload.
import { AppDataSource } from "../config/data-source";
import { Brand } from "../entities/Brand";
import { uploadToR2, r2Enabled, brandLogoKey, brandDarkLogoKey } from "../config/r2";

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
