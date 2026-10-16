// S3-1 routes. The /scope3 ones mount through src/scope3/router.ts; the
// company one through companyRouter below (mounted at /company in src/index.ts).
import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { listBoundary, listCategoryMap, postCategoryMap, putBoundary, putConsolidationApproach } from "./controller";

const router = Router();

router.get("/categories", listBoundary);
router.put("/categories/:n", putBoundary);
router.get("/category-map", listCategoryMap);
router.post("/category-map", postCategoryMap);

export const companyRouter = Router();
companyRouter.put("/:id/consolidation-approach", authenticate, putConsolidationApproach);

export default router;
