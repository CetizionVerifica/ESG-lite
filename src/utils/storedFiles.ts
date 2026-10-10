import { randomBytes } from "crypto";

type Uploader = {
  destroy: (publicId: string, options: { resource_type: string; invalidate?: boolean }) => Promise<{ result?: string } | undefined>;
};

// Evidence files are uploaded with resource_type "auto", so Cloudinary keeps
// PDFs and images as "image", videos as "video" and everything else as "raw";
// AI-service bills are "raw". The type isn't stored, and a destroy with the
// wrong type answers "not found", so each type is tried until one removes it.
const RESOURCE_TYPES = ["raw", "image", "video"] as const;

/** Removes a stored file whatever type it was stored as. True when it was removed. */
export const destroyStoredFile = async (uploader: Uploader, publicId: string): Promise<boolean> => {
  for (const resource_type of RESOURCE_TYPES) {
    // invalidate: also drop the CDN's cached copy, so a deleted file stops being served.
    const result = await uploader.destroy(publicId, { resource_type, invalidate: true });
    if (result?.result === "ok") return true;
  }
  return false;
};

// Cloudinary public ids are capped at 255 characters; the folder and the
// time/random prefix take about 40, so the cleaned name keeps at most 150.
const MAX_NAME_LENGTH = 150;

/** Cleans a file name and cuts it to MAX_NAME_LENGTH, keeping its extension. */
const shortName = (originalName: string): string => {
  const sanitized = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
  if (sanitized.length <= MAX_NAME_LENGTH) return sanitized;
  const dot = sanitized.lastIndexOf(".");
  const ext = dot > 0 && sanitized.length - dot <= 10 ? sanitized.slice(dot) : "";
  return sanitized.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
};

/** A public id no other upload can take, even for the same file name in the same millisecond. */
export const uniqueFileName = (originalName: string, now = Date.now(), random = () => randomBytes(5).toString("hex")): string =>
  `${now}_${random()}_${shortName(originalName)}`;
