/**
 * DS-4 routes, behind requireDesignStudio (01-contracts §4; R = Admin, Manager, Superadmin):
 *   GET    /studio/templates?kind=&format=&look=&q=&tag=     R → ReportTemplate[]
 *   GET    /studio/templates/:id                             R → ReportTemplateDetail
 *   GET    /studio/layouts?kind=&format=&pageKind=&template=&q=   R → ReportLayout[]
 *   GET    /studio/elements?group=&q=                        R → ElementTemplate[]
 *   POST   /studio/assets            multipart file (+ folder, alt)   R → StudioAsset (201; 200 when it already existed)
 *   GET    /studio/assets?folder=                            R → StudioAsset[]
 *   PATCH  /studio/assets/:id        {folder?, alt?}         R → StudioAsset
 *   DELETE /studio/assets/:id                                R → 204 (refused while a draft uses it)
 *   GET    /studio/assets/:id/file                           R → the image (local storage) or a redirect (R2)
 *   POST   /studio/assets/generate   {prompt, folder?}       R → StudioAsset (kind ai_image); 503 DS_AI_UNAVAILABLE without a provider
 * A Superadmin passes company_id (query, or body / multipart field).
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { ASSET_MAX_BYTES, DsError } from "../contracts";
import { studioCaller, type StudioRequest } from "../guard";
import { handle } from "../http";
import { assetFile, deleteAsset, generateAsset, listAssets, patchAsset, uploadAsset } from "./assets";
import { getTemplate, listElements, listLayouts, listTemplates } from "./service";

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

/** multer with DS codes: too large → 413 DS_ASSET_TOO_LARGE, a wrong field → 400 DS_VALIDATION. */
const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: ASSET_MAX_BYTES, files: 1 } }).single("file");
const upload = (req: Request, res: Response, next: NextFunction) =>
  parser(req, res, (err: unknown) => {
    if (!err) return next();
    const e = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? new DsError("DS_ASSET_TOO_LARGE") : new DsError("DS_VALIDATION", { issues: [{ path: "file", message: "Send one image in the field `file`" }] });
    res.status(e.status).json(e.toBody());
  });

router.get("/templates", handle("templates", async (req, res) => res.json(await listTemplates(caller(req), req.query))));
router.get("/templates/:id", handle("template", async (req, res) => res.json(await getTemplate(caller(req), req.params.id))));
router.get("/layouts", handle("layouts", async (req, res) => res.json(await listLayouts(caller(req), req.query))));
router.get("/elements", handle("elements", async (req, res) => res.json(await listElements(caller(req), req.query))));

router.get("/assets", handle("assets", async (req, res) => res.json(await listAssets(caller(req), req.query))));
router.post(
  "/assets/generate",
  handle("generate image", async (req, res) => res.status(201).json(await generateAsset(caller(req), req.body))),
);
router.post(
  "/assets",
  upload,
  handle("upload asset", async (req, res) => {
    const { asset, created } = await uploadAsset(caller(req), (req as Request & { file?: Express.Multer.File }).file, req.body);
    // An existing asset (same bytes) comes back with 200; a new one with 201.
    res.status(created ? 201 : 200).json(asset);
  }),
);
router.get(
  "/assets/:id/file",
  handle("asset file", async (req, res) => {
    const f = await assetFile(caller(req), req.params.id);
    if ("redirect" in f) return res.redirect(302, f.redirect);
    res.setHeader("Content-Type", f.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(f.bytes);
  }),
);
router.patch("/assets/:id", handle("move asset", async (req, res) => res.json(await patchAsset(caller(req), req.params.id, req.body))));
router.delete(
  "/assets/:id",
  handle("delete asset", async (req, res) => {
    await deleteAsset(caller(req), req.params.id);
    res.status(204).end();
  }),
);

export default router;
