/**
 * DS-1 · GET /studio/fonts/:file: the bundled WOFF2 faces, immutable-cached.
 * Behind the studio guard (switch on; Admin, Manager, Superadmin), like preview.
 * Only names from FONT_FILES are served; anything else answers 404.
 */
import { Router } from "express";
import { DsError } from "../../../studio/contracts/errors";
import { handle } from "../../../studio/http";
import { fontPath } from "./files";

const router = Router();

router.get(
  "/fonts/:file",
  handle("fonts", async (req, res) => {
    const p = fontPath(String(req.params.file ?? ""));
    if (!p) throw new DsError("DS_DOC_NOT_FOUND");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type("font/woff2");
    await new Promise<void>((resolve, reject) => res.sendFile(p, (err) => (err ? reject(err) : resolve())));
  }),
);

export default router;
