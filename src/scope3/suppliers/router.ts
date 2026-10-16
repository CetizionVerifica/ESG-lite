// S3-6 routes, mounted at /suppliers in src/index.ts behind `authenticate`
// (01-contracts.md §5 names them /suppliers, outside /scope3, as S3-1 mounts /company).
import { Router } from "express";
import {
  getCoverage,
  getFacilityData,
  getNameMatches,
  getSupplierDetail,
  getSupplierFactors,
  getSuppliers,
  postFacilityData,
  postNameMatch,
  postSupplier,
  postSupplierFactor,
  putSupplier,
} from "./controller";

const router = Router();

router.get("/", getSuppliers);
router.post("/", postSupplier);
router.get("/coverage", getCoverage);
router.get("/name-matches", getNameMatches);
router.post("/name-matches", postNameMatch);
router.get("/:id", getSupplierDetail);
router.put("/:id", putSupplier);
router.get("/:id/factors", getSupplierFactors);
router.post("/:id/factors", postSupplierFactor);
router.get("/:id/facility-data", getFacilityData);
router.post("/:id/facility-data", postFacilityData);

export default router;
