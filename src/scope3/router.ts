/**
 * The /scope3 router, mounted once in src/index.ts behind `authenticate`.
 * Each module adds one `router.use` line.
 *
 * STAND-IN written by S3-1 ahead of S3-0 (ESG-lite #134), which owns this
 * file and the mount. When S3-0 merges, take S3-0's version and add the
 * S3-1 line below to it.
 */
import { Router } from "express";
import boundaryRouter from "./boundary/router";

const router = Router();

router.use(boundaryRouter); // S3-1: /scope3/categories, /scope3/category-map

export default router;
