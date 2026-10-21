/**
 * PE-2 · custom brand fonts (docs/design-studio/pro/PE-2.md, decision E3).
 * (The bundled OFL fonts are served by src/reporting/studio/fonts/route.ts at
 * GET /studio/fonts/:file.) Behind requireDesignStudio; writes are Manager or
 * Superadmin only.
 *
 *   GET    /studio/brand-kit/fonts                      R  → BrandFontsResponse
 *   POST   /studio/brand-kit/fonts                      M  multipart file + FontUploadFields → 201 BrandFont
 *   DELETE /studio/brand-kit/fonts/:id                  M  → 204
 *   GET    /studio/brand-kit/fonts/:id/files/:fileId    R  → font bytes (font/woff2 | font/ttf | font/otf)
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { DsError, FONT_MAX_BYTES } from "../contracts";
import { requireManager, studioCaller, type StudioRequest } from "../guard";
import { handle } from "../http";
import { brandFontFile, deleteBrandFont, listBrandFonts, uploadBrandFont } from "./service";

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

/** multer with DS codes: over 5 MB → 413 DS_FONT_TOO_LARGE, a wrong field → 400 DS_VALIDATION. */
const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: FONT_MAX_BYTES, files: 1, fields: 10 } }).single("file");
const upload = (req: Request, res: Response, next: NextFunction) =>
  parser(req, res, (err: unknown) => {
    if (!err) return next();
    const e = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? new DsError("DS_FONT_TOO_LARGE") : new DsError("DS_VALIDATION", { issues: [{ path: "file", message: "Send one font in the field `file`" }] });
    res.status(e.status).json(e.toBody());
  });

router.get("/brand-kit/fonts", handle("brand fonts", async (req, res) => res.json(await listBrandFonts(caller(req)))));
router.post(
  "/brand-kit/fonts",
  requireManager,
  upload,
  handle("upload brand font", async (req, res) => res.status(201).json(await uploadBrandFont(caller(req), (req as Request & { file?: Express.Multer.File }).file, req.body))),
);
router.delete(
  "/brand-kit/fonts/:id",
  requireManager,
  handle("delete brand font", async (req, res) => {
    await deleteBrandFont(caller(req), req.params.id);
    res.status(204).end();
  }),
);
router.get(
  "/brand-kit/fonts/:id/files/:fileId",
  handle("brand font file", async (req, res) => {
    const f = await brandFontFile(caller(req), req.params.id, req.params.fileId);
    res.setHeader("Content-Type", f.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    // File ids are never reused: a new upload is a new id.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(f.bytes);
  }),
);

export default router;
