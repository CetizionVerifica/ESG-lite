/**
 * Design Studio API (DS-0): mounted once at `/studio` in src/index.ts, behind
 * `authenticate`. Each module appends ONE `router.use` line here, in module
 * order, with a `// DS-n` comment, and keeps its own routes in its folder
 * (docs/design-studio/03-lane-map.md "Shared files").
 *
 * Order matters: GET /studio/status comes before `requireDesignStudio`; every
 * other route sits behind it (403 DS_STUDIO_OFF, then DS_ROLE for Users).
 * Handlers that load a doc also call `assertKind` (DS_KIND_OFF).
 */
import { Router } from "express";
import { requireDesignStudio, studioStatus } from "./guard";
import studioFontsRouter from "../reporting/studio/fonts/route"; // DS-1
import sourcesRouter from "./sources/router"; // DS-2
import brandKitRouter from "./brandkit/router"; // DS-3
import libraryRouter from "./library/router"; // DS-4
import docsRouter from "./docs/router"; // DS-5
import jobsRouter from "./jobs/router"; // DS-11

const router = Router();

router.get("/status", studioStatus); // DS-0: {enabled, kinds: {ghg, sustainability}}, answers when off
router.use(requireDesignStudio); // DS-0: 403 DS_STUDIO_OFF / DS_ROLE below this line
router.use(studioFontsRouter); // DS-1: GET /studio/fonts/:file (bundled WOFF2)
router.use(sourcesRouter); // DS-2: /resolve, /docs/:id/inputs, /inputs/prefill, /data
router.use(brandKitRouter); // DS-3: /studio/brand-kit, /studio/styles
router.use(libraryRouter); // DS-4: /studio/templates, /layouts, /elements, /assets
router.use(docsRouter); // DS-5: /readiness, /docs, /docs/:id (+ rebuild, presence, duplicate)
router.use(jobsRouter); // DS-11: /docs/:id/preview.html, /docs/:id/jobs, /jobs/:id(/file), /docs/:id/versions

export default router;
