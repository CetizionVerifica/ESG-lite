// S3-10 routes, mounted through src/scope3/router.ts (/scope3, behind authenticate).
import { Router } from "express";
import { getProductSales, postProductSales, postSoldProductsPlan, putProductSale, putProductUseProfile } from "./controller";

const router = Router();

router.get("/product-sales", getProductSales);
router.post("/product-sales", postProductSales);
router.put("/product-sales/:id", putProductSale);
router.put("/products/:id/use-profile", putProductUseProfile);
router.post("/sold-products/plan", postSoldProductsPlan);

export default router;
