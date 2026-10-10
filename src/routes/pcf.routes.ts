import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { requirePcfAccess } from "../pcf/access";
import {
  listStudies,
  createStudy,
  getStudy,
  updateStudy,
  deleteStudy,
  replaceInputs,
  listMaterialFactors,
  createMaterialFactor,
  importMaterialFactors,
  getMaterialFactor,
  updateMaterialFactor,
  deleteMaterialFactor,
} from "../controllers/pcf.controller";
import {
  allocationPreview,
  calculateStudy,
  submitStudy,
  approveStudy,
  rejectStudy,
  publishStudy,
  reconciliation,
} from "../controllers/pcfFlow.controller";
import { exportStudy } from "../controllers/pcfExport.controller";

// Product carbon footprints (E1). Managers (own sites) and superadmins only;
// every other role gets 403.
const router = Router();

router.use(authenticate, requirePcfAccess);

router.get("/studies", listStudies);
router.post("/studies", createStudy);
router.get("/studies/:id", getStudy);
router.patch("/studies/:id", updateStudy);
router.delete("/studies/:id", deleteStudy);
router.put("/studies/:id/inputs", replaceInputs);
router.get("/studies/:id/allocation-preview", allocationPreview);
router.get("/studies/:id/export", exportStudy);
router.post("/studies/:id/calculate", calculateStudy);
router.post("/studies/:id/submit", submitStudy);
router.post("/studies/:id/approve", approveStudy);
router.post("/studies/:id/reject", rejectStudy);
router.post("/studies/:id/publish", publishStudy);
router.get("/reconciliation", reconciliation);

router.get("/material-factors", listMaterialFactors);
router.post("/material-factors", createMaterialFactor);
router.post("/material-factors/import", importMaterialFactors);
router.get("/material-factors/:id", getMaterialFactor);
router.patch("/material-factors/:id", updateMaterialFactor);
router.delete("/material-factors/:id", deleteMaterialFactor);

export default router;
