import { Router } from "express";
import { createUnit, getUnits, updateUnit, deleteUnit } from "../controllers/unitMaster.controller";

const router = Router();

router.post("/", createUnit);
router.get("/", getUnits);
router.put("/:id", updateUnit);
router.delete("/:id", deleteUnit);

export default router;
