import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middlewares/auth.middleware";
import { getSiteById } from "../controllers/site.controller";
import { getColumnConfigsBySiteAndCategory } from "../controllers/columnConfig.controller";
import {
  getEmissions,
  getEmissionsBySiteAndCategory,
  createEmission,
  updateEmission,
  deleteEmission,
  bulkDeleteEmissions,
  approveEmissionsByBatch,
  rejectEmissionsByBatch,
  deleteEmissionsByBatch,
  getEmissionBatches,
  getEmissionFactorForEmission,
  getPendingEmissions,
  approveEmission,
  rejectEmission,
  bulkApproveEmissions,
  bulkRejectEmissions,
  getApprovedEmissionsReport,
  getEdeReport,
  getNearTermTargetTables,
  getLongTermTargetChart,
  getGhgReportTables,
  getGhgReportDetails,
  downloadEmissions,
  managerUpdateEmission,
  calculateDistance,
  geocodeLocation,
  getPeriodTotal,
} from "../controllers/emission.controller";
import { getEmissionFactorsBySiteAndCategory } from "../controllers/emissionFactor.controller";
import { getUnitsBySiteAndCategory } from "../controllers/unit.controller";
import { getProductsBySite } from "../controllers/product.controller";
import {
  createProductionData,
  bulkCreateProductionData,
  getProductionDataBySite,
  updateProductionData,
  deleteProductionData,
  getEmissionIntensity,
  getEmissionIntensityComparison,
  getProductionDataForManager,
  approveProductionData,
  rejectProductionData,
  bulkApproveProductionData,
  bulkRejectProductionData,
  managerUpdateProductionData,
} from "../controllers/productionData.controller";
import {
  uploadDocument,
  uploadMultipleDocuments,
  getDocuments,
  getDocumentById,
  getDocumentsByEmission,
  updateDocument,
  deleteDocument,
  bulkDeleteDocuments,
} from "../controllers/document.controller";
import { getCompanies, getCompanyNameBySites, getReportingCalendar } from "../controllers/company.controller";
import { getMappingsByCompany } from "../controllers/emissionCategoryMapping.controller";
import { getAuditLogs } from "../controllers/auditLog.controller";
import { exportEmissions } from "../controllers/emissionExport.controller";
import { getThresholdByCompany } from "../controllers/threshold.controller";

const router = Router();

// Configure multer for document uploads (memory storage)
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// All routes require authentication but NOT superadmin
router.use(authenticate);

// Get site by ID (user can access their own site's data)
router.get("/sites/:id", getSiteById);

// Get column configs for a site and category
router.get("/column-configs/site/:siteId/category/:categoryId", getColumnConfigsBySiteAndCategory);

// Emission routes
router.get("/emissions", getEmissions);
router.get("/emissions/site/:siteId/category/:categoryId", getEmissionsBySiteAndCategory);
router.get("/emissions/pending", getPendingEmissions);
router.post("/emissions", createEmission);

// Download emissions as Excel (must come before :id routes)
router.get("/emissions/download", downloadEmissions);
router.get("/emissions/export", exportEmissions);

// Bulk routes must come BEFORE :id routes to avoid matching "bulk-approve" as an ID
router.put("/emissions/bulk-approve", bulkApproveEmissions);
router.put("/emissions/bulk-reject", bulkRejectEmissions);
router.delete("/emissions/bulk-delete", bulkDeleteEmissions);
router.put("/emissions/batch/:batchId/approve", approveEmissionsByBatch);
router.put("/emissions/batch/:batchId/reject", rejectEmissionsByBatch);
router.delete("/emissions/batch/:batchId", deleteEmissionsByBatch);
router.get("/emissions/batches", getEmissionBatches);

// Manager edit routes (must come BEFORE :id routes)
router.put("/emissions/manager-edit/:id", managerUpdateEmission);

// Routes with :id parameter
router.get("/emissions/:id/factor", getEmissionFactorForEmission);
router.put("/emissions/:id/approve", approveEmission);
router.put("/emissions/:id/reject", rejectEmission);
router.put("/emissions/:id", updateEmission);
router.delete("/emissions/:id", deleteEmission);

// Emission factor routes
router.get("/emission-factors/site/:siteId/category/:categoryId", getEmissionFactorsBySiteAndCategory);

// Unit routes
router.get("/units/site/:siteId/category/:categoryId", getUnitsBySiteAndCategory);

// Product routes (read-only for users)
router.get("/products/site/:siteId", getProductsBySite);

// Production data routes
router.get("/production-data/site/:siteId", getProductionDataBySite);
router.get("/production-data/manager", getProductionDataForManager);
router.post("/production-data", createProductionData);
router.post("/production-data/bulk-create", bulkCreateProductionData);

// Bulk routes must come BEFORE :id routes
router.put("/production-data/bulk-approve", bulkApproveProductionData);
router.put("/production-data/bulk-reject", bulkRejectProductionData);

// Manager edit routes (must come BEFORE :id routes)
router.put("/production-data/manager-edit/:id", managerUpdateProductionData);

// Routes with :id parameter
router.put("/production-data/:id/approve", approveProductionData);
router.put("/production-data/:id/reject", rejectProductionData);
router.put("/production-data/:id", updateProductionData);
router.delete("/production-data/:id", deleteProductionData);

// Emission intensity routes
router.get("/emission-intensity/site/:siteId", getEmissionIntensity);
router.get("/emission-intensity/comparison", getEmissionIntensityComparison);

// Document routes
router.get("/documents", getDocuments);
router.get("/documents/emission/:emissionId", getDocumentsByEmission);
router.get("/documents/:id", getDocumentById);
router.post("/documents", documentUpload.single("file"), uploadDocument);
router.post("/documents/multiple", documentUpload.array("files", 10), uploadMultipleDocuments);
router.put("/documents/:id", updateDocument);
router.delete("/documents/bulk-delete", bulkDeleteDocuments);
router.delete("/documents/:id", deleteDocument);
router.post("/emissions/approved", getApprovedEmissionsReport);
router.post("/reports/ede", getEdeReport)
router.get("/companies", getCompanies)
router.post("/companies/by-sites", getCompanyNameBySites)
router.get("/reporting-calendar", getReportingCalendar)
router.get("/category-mappings/company/:companyId", getMappingsByCompany)
router.post("/ghg/tables", getGhgReportTables);
router.post("/ghg/details",getGhgReportDetails)
router.post("/targets/tables",getNearTermTargetTables)
router.post("/targets/long-term-chart",getLongTermTargetChart)
router.post("/emissions/calculate-distance", calculateDistance);
router.post("/emissions/geocode-location", geocodeLocation);
router.get("/emissions/period-total", getPeriodTotal);
// Audit trail
router.get("/audit-logs", getAuditLogs);

//threshold routes
router.get("/thresholds/company/:companyId", getThresholdByCompany);

export default router;
