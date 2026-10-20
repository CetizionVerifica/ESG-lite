/**
 * PE-2 · custom brand fonts (docs/design-studio/pro/01-pro-editing-and-ai-templates.md,
 * decision E3). PRO-0 stub: 501 DS_NOT_BUILT. (The bundled OFL fonts are
 * served by src/reporting/studio/fonts/route.ts at GET /studio/fonts/:file.)
 *
 *   GET    /studio/brand-kit/fonts                      R  → BrandFontsResponse
 *   POST   /studio/brand-kit/fonts                      M  multipart file + FontUploadFields → 201 BrandFont
 *   DELETE /studio/brand-kit/fonts/:id                  M  → 204
 *   GET    /studio/brand-kit/fonts/:id/files/:fileId    R  → font bytes (font/woff2 | font/ttf | font/otf)
 */
import { Router } from "express";
import { requireManager } from "../guard";
import { notBuilt } from "../notBuilt";

const router = Router();

router.get("/brand-kit/fonts", notBuilt("PE-2"));
router.post("/brand-kit/fonts", requireManager, notBuilt("PE-2"));
router.delete("/brand-kit/fonts/:id", requireManager, notBuilt("PE-2"));
router.get("/brand-kit/fonts/:id/files/:fileId", notBuilt("PE-2"));

export default router;
