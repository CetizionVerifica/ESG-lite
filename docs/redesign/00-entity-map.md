# 00 · Entity map: what exists today and where it lands in the new design

Source of truth, read on 2026-10-09:
- **ESG-lite** (Node/Express + TypeORM, Postgres): `src/entities/*.ts`, `src/routes/*.ts`
- **python_AI_service** (FastAPI): `app/schemas/*.py`, `app/api/*.py`, `app/core/database.py`
- **ESG-lite_FE** (React 19 + Vite + Tailwind v4 + ECharts): `src/pages`, `src/services`

Nothing in this file changes code. "Proposed" items are suggestions for the backend team, flagged so page specs can depend on them explicitly.

---

## 1. Roles (`src/types/type.ts → UserRole`)
| Role | Scope of data | Today's home | New home |
|---|---|---|---|
| `Superadmin` | All companies (PlanetPulse staff) | `/superadmin` (company cards) | **Console** `/console` |
| `Admin` | One company: its users | `/admin-company/users` | **Users** `/users` |
| `Manager` | Their sites (`User.sites`, many-to-many `user_sites`) | `/manager-dashboard` | **Overview** `/overview` |
| `User` | Their site(s) + granted categories (`user_categories`) | `/data-entry` | **My month** `/my-month` |

Today routes have **no role guard**; only the sidebar hides links. The new shell (F2) adds a route guard.

## 2. Core domain entities (ESG-lite)

```
Country 1─* Site *─1 Company 1─1 Brand
                │  └─* Threshold (per company)
                ├─*─* Category (site_categories) ── Category.scope = "Scope 1|2|3" or null (savings)
                ├─* User (User.site)   *─* User (managers, user_sites)
                ├─* ColumnConfig (site × category) *─* Column (column_config_columns)
                ├─* EmissionFactor (site × category × year)
                ├─* Unit (site × category)
                ├─* Product 1─* ProductionData
                └─* Emission ── EmissionDocument (1─*)
EmissionCategoryMapping (company_category_name → global_category_name → emission_factor_id)
AuditLog (entity_type emission | production_data)
Notification (per user)
```

| Entity | Key fields | Status / enums | Used by pages (new IDs) |
|---|---|---|---|
| **Company** | name, address, contact_person, email, phone_number, industry, region, employee_range, cin_number, status(bool), subscription_id, isEmailVerified, esgMitraAccess | active / inactive | P16 Console, P17 Clients |
| **Brand** | companyId (PK), name, primary, accent, coverFrom, coverTo, logoUrl, logoPublicId, updatedAt | — | F1 theme engine, P01 Sign in, P10/P11 report covers, P18 Brand themes |
| **Country** | name, code | — | P21 Reference data, P19 Sites |
| **Site** | name, address, contact_person, company, country, categories[], users[], managers[] | — | everywhere as the **Site** context chip; P19 |
| **Category** | category_name, scope (`Scope 1/2/3` or null = saving e.g. Renewable Electricity) | — | context chip; P21; scope colours `--t-s1/2/3` |
| **Column** | column_name, column_type | — | P24 Capture setup |
| **ColumnConfig** | config_name, site, category, column_options, column_dependencies, dependent_options, emission_category_mapping, extra_fields[], calculation (mode per_method/per_unit), columns[] | — | **drives the dynamic form** in P03 Add data and the edit drawer in P07; configured in P24 |
| **EmissionFactor** | site, category, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, upload_batch_id | — | P22 Factors; shown as "factor used" in P03/P04/P07 |
| **EmissionCategoryMapping** | company_id, site_id, category_id, company_category_name, global_category_name, emission_factor_id | — | P23 Category mappings |
| **Unit** | unit_name, description, site, category | — | P21 Reference data; `UnitInput` in P03 |
| **Emission** | activity_data (jsonb), total_emission, unit, date_of_reporting, activity_data_unit, status, review_comment, reviewed_by/at, created_by/at, category, site, reporting_period (monthly/yearly), year_type (CY/FY), fera_linked_id, upload_batch_id, extra_data, emission_factor_snapshot | **pending · approved · rejected** | P02, P03, P04, P06, P07, P10, P11, P12 |
| **EmissionDocument** | file_name, original_name, cloudinary urls, file_type, file_size, document_type, description, emission, uploaded_by | invoice · receipt · report · certificate · other | P03 evidence step, P04/P07 evidence column + `DocumentViewer` |
| **Product** | name, description, unit, site | — | P25 Products; P05/P08 |
| **ProductionData** | product, site, quantity, unit, start_date, end_date, notes, status, review_comment, reviewed_by/at, created_by | **pending · approved · rejected** | P05, P08; intensity KPIs in P06 |
| **Threshold** | company, threshold_percentage (default 5.0) | — | P26 Thresholds; "above threshold" alerts in P06/P07 |
| **User** | name, last_name, phone_number, email, role, site, sites[], categories[], notification_preferences, timezone | — | P09, P14, P15, P20 |
| **AuditLog** | entity_type, entity_id, action, changed_fields {old,new}, reason, changed_by, changed_at | — | `AuditTimeline` in P04, P07, P08 |
| **Notification** | user, type, title, message, link, read, created_at | read / unread | bell popover (F2), P13 |

### Derived concepts (not tables, but the UI treats them as first-class)
| Concept | How it is computed today | Where it shows |
|---|---|---|
| **Gross / Net / Saved** | Gross = Σ approved scoped emissions; Saved = categories with `scope = null`; Net = Gross − Saved | P06 KPI strip, P10 |
| **Intensity** | approved emissions ÷ approved production (`/emission-intensity/*`) | P06, P10 |
| **Submission status** | `/manager/submission-status?month=YYYY-MM` → per user `submitted | missing` | P02 My month, P06 attention list |
| **Upload batch** | `Emission.upload_batch_id` groups bulk rows | P07 Batches tab |
| **FERA link** | `Emission.fera_linked_id` (fuel- and energy-related activities child row) | P07 merged into parent row |
| **Reporting period** | `reporting_period` monthly | yearly; `year_type` CY | FY; mode lock per site×category (`services/reportingPeriod.ts`) | Period chip everywhere; P03 |
| **Deadlines** | cron: reminder on the 10th, escalation on the 15th (`workers/deadlineScheduler.ts`) | P02 due date banner, P13 |

## 3. AI service entities (python_AI_service)
These tables live in the same Postgres but are owned by the FastAPI service (`VITE_OCR_API_URL` in the FE).

| Table / schema | Key fields | Endpoint | UI surface in new design |
|---|---|---|---|
| `invoice` (+ `InvoiceData`, `LineItem`, `ActivityEntry`) | file_name, cloudinary_url, file_type, file_size, uploaded_by, site_id, category_id; extracted: invoice_number, invoice_date, billing_month_end, vendor, totals, currency, line_items[], activities[] | `POST /v1/invoices/upload`, `POST /v1/extract`, `GET/DELETE /v1/invoices` | **P03 "Start from a bill"**: drop a PDF → extracted fields prefilled with confidence; evidence auto-attached |
| `CategorySuggestion` | emission_category_name, category_id, scope, denominator_unit, confidence 0–100 | part of extraction | P03 category suggestion chip ("Diesel · 92% match") |
| `EmissionReady` | site_id, category_id, activity_data, activity_data_unit, date_of_reporting, total_emission | part of extraction | P03 review step |
| Validation result | cross-check of totals vs line items | part of extraction | P03 warning callout ("Bill total doesn't match line items") |
| `emission_factor_uploads` | file_name, uploaded_by, site_id, category_ids[], layout_type (simple / sub_columns / disposal_pivot), total_records, records_created, records_skipped, status | `POST /v1/emission-factors/parse-excel`, `/re-analyze`, `GET/PATCH/DELETE /uploads` | **P22 Factors → Import**: AI reads any factor sheet layout, shows detected schema + parent-category suggestions (high/medium/low) |
| `ParsedMappingRow` | company_category_name, global_category_name, factor_value, unit | `POST /v1/category-mappings/parse-excel` | **P23 Category mappings → Import** |
| `uploaded_documents` | document_name, total_rows, status | `POST /v1/excel/upload → unique-categories → preview → import` | **P27 Bulk upload** stepper |
| Column inference | `InferColumnsRequest/Response` | `POST /v1/column-config/infer-columns`, `infer-all-columns` (called by ESG-lite `columnConfigGenerator.ts`) | **P24 Capture setup → Auto-generate** |
| Sea route | origin/destination lat-lng → LineString, duration | `POST /v1/sea-route` (called by ESG-lite `emission.controller.ts`) | P03 distance calculator for sea freight |

**Design rule for AI output:** anything the AI fills is marked with a small "AI" chip and a confidence, is always editable, and is never saved without the person confirming. Low confidence (< 60) is shown in the warn tint.

## 4. Proposed additions (backend, for the redesign; not built)
| # | Change | Why | Needed by |
|---|---|---|---|
| <a id="brand"></a>B1 | `Brand.logo_on_dark_url`, `Brand.default_look` (`classic|light|night`), optional `Brand.scope3_colour` | Classic/Night top bar needs a white logo; client picks default look | F1, P18 |
| B2 | `User.appearance` (`light|dark|system`) | Persist per user instead of `localStorage` | F2, P14 |
| B3 | Route-level role guard on the FE + 403 page | Today any role can open any URL | F2 |
| B4 | `GET /manager/overview?period=&siteIds=` aggregate endpoint | P06 today downloads every emission per site and aggregates in the browser | P06 |
| B5 | `GET /user/my-month?month=` (categories due, done, pending, rejected for the signed-in user) | Powers the contributor checklist | P02 |
| B6 | Server-side sort + search on `/emissions` paginated | Ledger table sort/search | P07, P04 |
| B7 | Year export (`/emissions/export?year=`) | Today export needs a month | P07 |
| B8 | Link AI `invoice.id` ↔ `EmissionDocument` | So evidence shows "extracted by AI" and the original bill | P03, P07 |

## 5. Page inventory: old screens → new pages
| New ID | New page | Replaces (FE files) | Roles |
|---|---|---|---|
| P01 | Sign in, Reset password | `Login.tsx`, `AdminLogin.tsx`, `ResetPassword.tsx` | all |
| P02 | My month (new) | — (uses submission status) | User |
| P03 | Add data | `UserDataEntry/*` (5,557 lines), `UserDataEntryPage.tsx`, `SmartUploadModal.tsx`, `DistanceCalculatorModal`, `MapView` | User |
| P04 | My entries | `UserEmissionsPage.tsx`, `EmissionsFilterSidebar.tsx` | User |
| P05 | Production (contributor) | `ProductionDataPage.tsx`, `ProductionDataBulkUpload.tsx` | User |
| P06 | Overview | `ManagerDashboard/*`, `SubmissionStatusWidget.tsx` | Manager |
| P07 | Approvals + Emissions ledger | `Manager/index.tsx`, `Manager/EmissionsTable.tsx`, `ManagerPage.tsx` | Manager |
| P08 | Production review | `ManagerProductionDataPage.tsx` | Manager |
| P09 | Team access | `ManagerUsers/index.tsx` | Manager |
| P10 | GHG report | `GhgReport/*` incl. `pdf/` | Manager, Superadmin |
| P11 | EDE report | `Reports/*` | Manager, Superadmin |
| P12 | Targets (SBTi) | `sbti/*` | Manager |
| P13 | Notifications | `NotificationsPage.tsx` | all |
| P14 | Settings | `SettingsPage.tsx` | all |
| P15 | Company users | `CompanyAdmin/CompanyAdminUsersPage.tsx` | Admin |
| P16 | Console | `SuperAdminPage.tsx` | Superadmin |
| P17 | Clients + onboarding | `CompanyPage.tsx`, `CompanyOnboardingPage.tsx` | Superadmin |
| P18 | Brand themes | `BrandSettings/BrandSettings.tsx` | Superadmin (Admin view-only, proposed) |
| P19 | Sites | `SitePage.tsx` | Superadmin |
| P20 | Users (global) | `UserPage.tsx` | Superadmin |
| P21 | Reference data (Countries, Categories, Units) | `CountryPage.tsx`, `CategoryPage.tsx`, `UnitsPage.tsx` | Superadmin |
| P22 | Emission factors | `EmissionFactorPage.tsx`, `EmissionFactorList.tsx` | Superadmin |
| P23 | Category mappings | `CategoryMappingPage.tsx`, `MappingUploadModal.tsx` | Superadmin |
| P24 | Capture setup (Columns + Column configs) | `ColumnPage.tsx`, `ColumnConfig.tsx`, `ColumnList`, `ColumnConfigList`, `EditColumnConfigModal`, `AutoGenerateColumnConfigModal` | Superadmin |
| P25 | Products | `ProductPage.tsx` | Superadmin |
| P26 | Thresholds | `ThresholdValuePage.tsx` | Superadmin |
| P27 | Bulk upload | `UploadPage.tsx`, `BulkUpload/*` | Superadmin |
