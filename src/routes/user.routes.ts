import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middlewares/auth.middleware";
import { getSiteById } from "../controllers/site.controller";
import { getColumnConfigsBySiteAndCategory } from "../controllers/columnConfig.controller";
import {
  getEmissions,
  getEmissionBreakdown,
  getEmissionsBySiteAndCategory,
  getPeriodMode,
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
import { getUnitOptionsBySiteAndCategory, getUnitsBySiteAndCategory } from "../controllers/unit.controller";
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
  linkInvoiceDocuments,
  findBackedEntries,
} from "../controllers/document.controller";
import { getCompanies, getCompanyNameBySites, getReportingCalendar } from "../controllers/company.controller";
import { getMappingsByCompany } from "../controllers/emissionCategoryMapping.controller";
import { getAuditLogs } from "../controllers/auditLog.controller";
import { exportEmissions } from "../controllers/emissionExport.controller";
import { getThresholdByCompany } from "../controllers/threshold.controller";
import { getMyMonth } from "../controllers/myMonth.controller";
import {
  requireReviewer,
  guardSiteParam,
  guardBodySites,
  guardBodyEntrySites,
  guardQuerySites,
  guardCompanyParam,
  guardEmissionParam,
  guardEmissionIds,
  guardEmissionReview,
  guardEmissionIdsReview,
  guardProductionParam,
  guardProductionReview,
  guardProductionIdsReview,
  guardBatch,
  guardAuditEntity,
} from "../middlewares/scope.middleware";
import { auditReview, guardApprovedDelete } from "../middlewares/audit.middleware";
import { guardPeriodOpen } from "../scope3/review/guard";
import { deleteNothing, getHistory, postCheck, postNothing, postSubmit } from "../scope3/review/controller";

const router = Router();

// Configure multer for document uploads (memory storage)
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// All routes require authentication but NOT superadmin
router.use(authenticate);

// Contributor checklist for a month (redesign P02)
router.get("/my-month", getMyMonth);
// S3-15 part 2: "Nothing this month" for a site and category (review workflow v2).
router.post("/my-month/nothing", postNothing);
router.delete("/my-month/nothing", deleteNothing);

// Get site by ID (user can access their own site's data)
router.get("/sites/:id", guardSiteParam("id"), getSiteById);

// Get column configs for a site and category
router.get("/column-configs/site/:siteId/category/:categoryId", guardSiteParam("siteId"), getColumnConfigsBySiteAndCategory);

// Emission routes
router.get("/emissions", getEmissions);
router.get("/emissions/site/:siteId/category/:categoryId", getEmissionsBySiteAndCategory);
router.get("/emissions/period-mode/site/:siteId/category/:categoryId", guardSiteParam("siteId"), getPeriodMode);
router.get("/emissions/pending", getPendingEmissions);
router.post("/emissions", guardBodySites("site_id"), guardPeriodOpen("create"), createEmission);
// S3-15 part 2: submit own drafts; dry-run checks for the live panel (saves nothing).
router.post("/emissions/submit", postSubmit);
router.post("/emissions/check", postCheck);

// Download emissions as Excel (must come before :id routes)
router.get("/emissions/download", downloadEmissions);
router.get("/emissions/export", exportEmissions);
router.get("/emissions/breakdown", getEmissionBreakdown);

// Bulk routes must come BEFORE :id routes to avoid matching "bulk-approve" as an ID
// guardPeriodOpen (S3-15 part 2): 409 PERIOD_LOCKED for a row in a closed site-month.
router.put("/emissions/bulk-approve", requireReviewer, guardEmissionIdsReview("approve"), guardPeriodOpen("ids"), auditReview("emission", "ids"), bulkApproveEmissions);
router.put("/emissions/bulk-reject", requireReviewer, guardEmissionIdsReview("reject"), guardPeriodOpen("ids"), auditReview("emission", "ids"), bulkRejectEmissions);
router.delete("/emissions/bulk-delete", guardEmissionIds, guardPeriodOpen("ids"), guardApprovedDelete("emission", "ids"), auditReview("emission", "ids"), bulkDeleteEmissions);
router.put("/emissions/batch/:batchId/approve", requireReviewer, guardBatch("approve"), guardPeriodOpen("batch"), auditReview("emission", "batch"), approveEmissionsByBatch);
router.put("/emissions/batch/:batchId/reject", requireReviewer, guardBatch("reject"), guardPeriodOpen("batch"), auditReview("emission", "batch"), rejectEmissionsByBatch);
router.delete("/emissions/batch/:batchId", guardBatch(), guardPeriodOpen("batch"), guardApprovedDelete("emission", "batch"), auditReview("emission", "batch"), deleteEmissionsByBatch);
router.get("/emissions/batches", guardQuerySites("siteIds"), getEmissionBatches);

// Manager edit routes (must come BEFORE :id routes)
router.put("/emissions/manager-edit/:id", requireReviewer, guardEmissionParam(), guardPeriodOpen("param"), managerUpdateEmission);

// Routes with :id parameter
router.get("/emissions/:id/factor", guardEmissionParam(), getEmissionFactorForEmission);
router.get("/emissions/:id/history", guardEmissionParam(), getHistory); // S3-15: the row's last N months
router.put("/emissions/:id/approve", requireReviewer, guardEmissionReview("id", "approve"), guardPeriodOpen("param"), auditReview("emission", "param"), approveEmission);
router.put("/emissions/:id/reject", requireReviewer, guardEmissionReview("id", "reject"), guardPeriodOpen("param"), auditReview("emission", "param"), rejectEmission);
router.put("/emissions/:id", guardEmissionParam(), guardPeriodOpen("param"), updateEmission);
router.delete("/emissions/:id", guardEmissionParam(), guardPeriodOpen("param"), guardApprovedDelete("emission", "param"), auditReview("emission", "param"), deleteEmission);

// Emission factor routes
router.get("/emission-factors/site/:siteId/category/:categoryId", guardSiteParam("siteId"), getEmissionFactorsBySiteAndCategory);

// Unit routes
router.get("/units/site/:siteId/category/:categoryId/by-activity", guardSiteParam("siteId"), getUnitOptionsBySiteAndCategory);
router.get("/units/site/:siteId/category/:categoryId", guardSiteParam("siteId"), getUnitsBySiteAndCategory);

// Product routes (read-only for users)
router.get("/products/site/:siteId", guardSiteParam("siteId"), getProductsBySite);

// Production data routes
router.get("/production-data/site/:siteId", guardSiteParam("siteId"), getProductionDataBySite);
router.get("/production-data/manager", guardQuerySites("siteIds"), getProductionDataForManager);
router.post("/production-data", guardBodySites("site_id"), createProductionData);
router.post("/production-data/bulk-create", guardBodyEntrySites, bulkCreateProductionData);

// Bulk routes must come BEFORE :id routes
router.put("/production-data/bulk-approve", requireReviewer, guardProductionIdsReview, auditReview("production_data", "ids"), bulkApproveProductionData);
router.put("/production-data/bulk-reject", requireReviewer, guardProductionIdsReview, auditReview("production_data", "ids"), bulkRejectProductionData);

// Manager edit routes (must come BEFORE :id routes)
router.put("/production-data/manager-edit/:id", requireReviewer, guardProductionParam(), managerUpdateProductionData);

// Routes with :id parameter
router.put("/production-data/:id/approve", requireReviewer, guardProductionReview(), auditReview("production_data", "param"), approveProductionData);
router.put("/production-data/:id/reject", requireReviewer, guardProductionReview(), auditReview("production_data", "param"), rejectProductionData);
router.put("/production-data/:id", guardProductionParam(), updateProductionData);
router.delete("/production-data/:id", guardProductionParam(), auditReview("production_data", "param"), deleteProductionData);

// Emission intensity routes
router.get("/emission-intensity/site/:siteId", guardSiteParam("siteId"), getEmissionIntensity);
router.get("/emission-intensity/comparison", guardQuerySites(), getEmissionIntensityComparison);

// Document routes
router.get("/documents", getDocuments);
router.get("/documents/emission/:emissionId", getDocumentsByEmission);
router.get("/documents/:id", getDocumentById);
router.post("/documents", documentUpload.single("file"), uploadDocument);
router.post("/documents/multiple", documentUpload.array("files", 10), uploadMultipleDocuments);
router.post("/documents/from-invoice", linkInvoiceDocuments);
router.post("/documents/already-backing", guardBodySites("site_id"), findBackedEntries);
router.put("/documents/:id", updateDocument);
router.delete("/documents/bulk-delete", bulkDeleteDocuments);
router.delete("/documents/:id", deleteDocument);
router.post("/emissions/approved", guardBodySites("siteIds"), getApprovedEmissionsReport);
router.post("/reports/ede", guardBodySites("siteIds"), getEdeReport)
router.get("/companies", getCompanies)
router.post("/companies/by-sites", guardBodySites("siteIds"), getCompanyNameBySites)
router.get("/reporting-calendar", getReportingCalendar)
router.get("/category-mappings/company/:companyId", guardCompanyParam("companyId"), getMappingsByCompany)
router.post("/ghg/tables", guardBodySites("siteIds"), getGhgReportTables);
router.post("/ghg/details", guardBodySites("siteIds"), getGhgReportDetails)
router.post("/targets/tables", guardBodySites("siteIds"), getNearTermTargetTables)
router.post("/targets/long-term-chart", guardBodySites("siteIds"), getLongTermTargetChart)
router.post("/emissions/calculate-distance", calculateDistance);
router.post("/emissions/geocode-location", geocodeLocation);
router.get("/emissions/period-total", guardQuerySites(), getPeriodTotal);
// Audit trail
router.get("/audit-logs", guardAuditEntity, getAuditLogs);

//threshold routes
router.get("/thresholds/company/:companyId", guardCompanyParam("companyId"), getThresholdByCompany);

export default router;
