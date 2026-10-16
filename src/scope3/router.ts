/**
 * Scope 3 API (S3-0): mounted once at `/scope3` in src/index.ts, behind
 * `authenticate`. Empty until the modules add their routes.
 *
 * Each module appends ONE line here, in module order, and keeps its own
 * routes in its folder (docs/scope3/03-lane-map.md, shared files):
 *   router.use(taxonomyRouter); // S3-1
 */
import { Router } from "express";
import boundaryRouter from "./boundary/router";
import assetsRouter from "./assets/router";
import commutingRouter from "./commuting/router";
import baseYearRouter from "./baseYear/router";
import soldProductsRouter from "./soldProducts/router";

const router = Router();

router.use(boundaryRouter); // S3-1: /scope3/categories, /scope3/category-map
router.use(commutingRouter); // S3-9: /scope3/commuting/surveys
router.use(soldProductsRouter); // S3-10: /scope3/product-sales, /scope3/products/:id/use-profile, /scope3/sold-products/plan
router.use(assetsRouter); // S3-11: /scope3/investments, /scope3/assets/sites
router.use(baseYearRouter); // S3-14: /scope3/base-year, /scope3/recalculations

export default router;
