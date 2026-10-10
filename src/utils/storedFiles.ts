type Uploader = {
  destroy: (publicId: string, options: { resource_type: string }) => Promise<{ result?: string } | undefined>;
};

// Evidence files are uploaded with resource_type "auto", so Cloudinary keeps
// PDFs and images as "image", videos as "video" and everything else as "raw";
// AI-service bills are "raw". The type isn't stored, and a destroy with the
// wrong type answers "not found", so each type is tried until one removes it.
const RESOURCE_TYPES = ["raw", "image", "video"] as const;

/** Removes a stored file whatever type it was stored as. True when it was removed. */
export const destroyStoredFile = async (uploader: Uploader, publicId: string): Promise<boolean> => {
  for (const resource_type of RESOURCE_TYPES) {
    const result = await uploader.destroy(publicId, { resource_type });
    if (result?.result === "ok") return true;
  }
  return false;
};

/** A public id no other upload can take, even for the same file name in the same millisecond. */
export const uniqueFileName = (originalName: string, now = Date.now(), random = Math.random): string => {
  const sanitized = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${now}_${random().toString(36).slice(2, 10)}_${sanitized}`;
};
