/**
 * Scope 3 API (S3-0): mounted once at `/scope3` in src/index.ts, behind
 * `authenticate`. Empty until the modules add their routes.
 *
 * Each module appends ONE line here, in module order, and keeps its own
 * routes in its folder (docs/scope3/03-lane-map.md, shared files):
 *   router.use(taxonomyRouter); // S3-1
 */
import { Router } from "express";

const router = Router();

export default router;
