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
  updateMaterialFactor,
  deleteMaterialFactor,
} from "../controllers/pcf.controller";

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

router.get("/material-factors", listMaterialFactors);
router.post("/material-factors", createMaterialFactor);
router.patch("/material-factors/:id", updateMaterialFactor);
router.delete("/material-factors/:id", deleteMaterialFactor);

export default router;
