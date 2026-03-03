import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middlewares/auth.middleware";
import { requireSuperAdmin } from "../middlewares/role.middleware";
import {
  createCompany,
  getCompanies,
  updateCompany,
  deleteCompany,
} from "../controllers/company.controller";
import { onboardCompany } from "../controllers/onboarding.controller";
import { createSite, deleteSite, getSites, updateSite, getSiteMasterData, updateSiteMasterData, initializeSiteMasterData, getAssignedSiteMasterData } from "../controllers/site.controller";
import { getUsers, deleteUser, updateUser, createUser } from "../controllers/user.controller";
import {
  createCountry,
  deleteCountry,
  getAllCountries,
  updateCountry,
} from "../controllers/country.controller";
import { createCategory, deleteCategory, getCategories, updateCategory } from "../controllers/category.controller";
import { createEmissionFactor, deleteEmissionFactor, getEmissionFactorById, getEmissionFactors, getEmissionFactorsByCategory, getEmissionFactorsBySite, updateEmissionFactor, bulkCreateEmissionFactors, bulkDeleteEmissionFactors } from "../controllers/emissionFactor.controller";
import { bulkCreateColumns, createColumn, deleteColumn, getColumns, updateColumn } from "../controllers/column.controller";
import {
  getColumnConfigs,
  getColumnConfigById,
  getColumnConfigsByCategory,
  getColumnConfigsBySite,
  getColumnConfigsBySiteAndCategory,
  createColumnConfig,
  updateColumnConfig,
  deleteColumnConfig,
  addColumnsToConfig,
  removeColumnsFromConfig,
} from "../controllers/columnConfig.controller";
import {
  getUnits,
  getUnitById,
  getUnitsBySiteAndCategory,
  createUnit,
  updateUnit,
  deleteUnit,
} from "../controllers/unit.controller";
import {
  createUnit as createUnitMaster,
  getUnits as getUnitMasters,
  updateUnit as updateUnitMaster,
  deleteUnit as deleteUnitMaster,
} from "../controllers/unitMaster.controller";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} from "../controllers/product.controller";
import {
  uploadEmissionsExcel,
  getSitesForUpload,
  getCategoriesForUpload,
} from "../controllers/upload.controller";

import {
  createMasterData,
  deleteMasterData,
  getMasterData,
  updateMasterData,
  seedDemoData,
  getCategories as getMDCategories,
  getSubcategories as getMDSubcategories,
} from "../controllers/masterData.controller";

// ... existing imports ...

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files are allowed"));
    }
  },
});

const router = Router();

// Public/Authenticated Routes (No SuperAdmin required)
router.get("/sites/:id/master-data", authenticate, getSiteMasterData);
router.get("/sites/:id/assigned-master-data", authenticate, getAssignedSiteMasterData);

// Super Admin Protected Routes
router.use(authenticate, requireSuperAdmin);

// Onboarding
router.post("/onboarding/company", onboardCompany);

// Company
router.post("/companies", createCompany);
router.get("/companies", getCompanies);
router.put("/companies/:id", updateCompany);
router.delete("/companies/:id", deleteCompany);

// Site
router.post("/sites", createSite);
router.get("/sites", getSites);
router.put("/sites/:id", updateSite);
router.delete("/sites/:id", deleteSite);
// router.get("/sites/:id/master-data", getSiteMasterData); // Moved up
router.put("/sites/:id/master-data", updateSiteMasterData);
router.post("/sites/:id/master-data/init", initializeSiteMasterData);

// User
router.get("/users", getUsers);
router.delete("/users/:id", deleteUser);
router.post("/users", createUser);
router.patch("/users/:id", updateUser);

//Country
router.post("/countries", createCountry);
router.get("/countries", getAllCountries);
router.put("/countries/:id", updateCountry);
router.delete("/countries/:id", deleteCountry);

//Category
router.post("/categories", createCategory);
router.get("/categories", getCategories);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

//emission factor routes
router.post("/emission-factors", createEmissionFactor);
router.post("/emission-factors/bulk", bulkCreateEmissionFactors);
router.delete("/emission-factors/bulk", bulkDeleteEmissionFactors);
router.get("/emission-factors", getEmissionFactors);
router.get("/emission-factors/:id", getEmissionFactorById);
router.put("/emission-factors/:id", updateEmissionFactor);
router.delete("/emission-factors/:id", deleteEmissionFactor);
router.get("/emission-factors/site/:siteId", getEmissionFactorsBySite);
router.get("/emission-factors/category/:categoryId", getEmissionFactorsByCategory);

//column management routes
router.post("/columns", createColumn);
router.get("/columns", getColumns);
router.post("/columns/bulk", bulkCreateColumns);
router.put("/columns/:id", updateColumn);
router.delete("/columns/:id", deleteColumn);

//column config routes
router.get("/column-configs", getColumnConfigs);
router.get("/column-configs/:id", getColumnConfigById);
router.get("/column-configs/category/:categoryId", getColumnConfigsByCategory);
router.get("/column-configs/site/:siteId", getColumnConfigsBySite);
router.get("/column-configs/site/:siteId/category/:categoryId", getColumnConfigsBySiteAndCategory);
router.post("/column-configs", createColumnConfig);
router.put("/column-configs/:id", updateColumnConfig);
router.delete("/column-configs/:id", deleteColumnConfig);
router.post("/column-configs/:id/columns", addColumnsToConfig);
router.delete("/column-configs/:id/columns", removeColumnsFromConfig);

// Unit routes
router.get("/units", getUnits);
router.get("/units/:id", getUnitById);
router.get("/units/site/:siteId/category/:categoryId", getUnitsBySiteAndCategory);
router.post("/units", createUnit);
router.put("/units/:id", updateUnit);
router.delete("/units/:id", deleteUnit);

// Global Unit Master routes
router.post("/unit-master", createUnitMaster);
router.get("/unit-master", getUnitMasters);
router.put("/unit-master/:id", updateUnitMaster);
router.delete("/unit-master/:id", deleteUnitMaster);

// Product routes
router.post("/products", createProduct);
router.get("/products", getProducts);
router.get("/products/:id", getProductById);
router.put("/products/:id", updateProduct);
router.delete("/products/:id", deleteProduct);

// Upload routes
router.post("/upload/emissions", upload.single("file"), uploadEmissionsExcel);
router.get("/upload/sites", getSitesForUpload);
router.get("/upload/categories", getCategoriesForUpload);

// Master Data routes
router.post("/master-data", createMasterData);
router.get("/master-data", getMasterData);
router.get("/master-data/categories", getMDCategories);
router.get("/master-data/subcategories", getMDSubcategories);
router.put("/master-data/:id", updateMasterData);
router.delete("/master-data/:id", deleteMasterData);
router.post("/master-data/seed", seedDemoData);

export default router;
