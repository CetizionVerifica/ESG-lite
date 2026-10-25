import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { Company } from "../entities/Company";
import { Site } from "../entities/Site";
import { User } from "../entities/User";
import { Category } from "../entities/Category";
import { EmissionFactor } from "../entities/EmissionFactor";
import { Emission } from "../entities/Emission";
import { ColumnConfig } from "../entities/ColumnConfig";
import { ColumnEntity } from "../entities/Column";
import { Country } from "../entities/Country";
import { Unit } from "../entities/Unit";
import { Product } from "../entities/Product";
import { ProductionData } from "../entities/ProductionData";
import { EmissionDocument } from "../entities/EmissionDocument";
import { EmissionCategoryMapping } from "../entities/EmissionCategoryMapping";
import { AuditLog } from "../entities/AuditLog";
import { Notification } from "../entities/Notification";
import { Brand } from "../entities/Brand";
import dotenv from "dotenv";
import { EmissionThreshold } from "../entities/Threshold";
import { MaterialFactor } from "../entities/MaterialFactor";
import { PcfStudy } from "../entities/PcfStudy";
import { PcfInput } from "../entities/PcfInput";
import { PcfAllocation } from "../entities/PcfAllocation";
import { PcfResult } from "../entities/PcfResult";
import { SupplierRequest } from "../entities/SupplierRequest";
import { McpToolCall } from "../entities/McpToolCall";
import { ImportPlan, ImportPlanRow, ImportPlanMatch } from "../entities/ImportPlan";
import { ImportMappingProfile } from "../entities/ImportMappingProfile";
import { OauthClient } from "../entities/OauthClient";
import { OauthGrant } from "../entities/OauthGrant";
import { OauthCode } from "../entities/OauthCode";
import { OauthToken } from "../entities/OauthToken";
import { CompanyScope3Category } from "../entities/CompanyScope3Category";
import { CategoryGhgMapProposal } from "../entities/CategoryGhgMapProposal";
import { Investment } from "../entities/Investment";
import { Scope3ScreeningInput } from "../entities/Scope3ScreeningInput";
import { FxRate } from "../entities/FxRate";
import { PriceDeflator } from "../entities/PriceDeflator";
import { CompanyBaseYear } from "../entities/CompanyBaseYear"; // S3-14
// KPI-2: the KPI library
import { KpiFramework } from "../entities/KpiFramework";
import { KpiDefinition } from "../entities/KpiDefinition";
import { KpiDisclosure } from "../entities/KpiDisclosure";
import { KpiDisclosureMap } from "../entities/KpiDisclosureMap";
// KPI-4: the KPI value store
import { KpiValue } from "../entities/KpiValue";
import { KpiValueEvidence } from "../entities/KpiValueEvidence";
import { KpiPeriodLock } from "../entities/KpiPeriodLock";
// KPI-3: company setup
import { CompanyKpiSettings } from "../entities/CompanyKpiSettings";
import { CompanyFramework } from "../entities/CompanyFramework";
import { CompanyMaterialTopic } from "../entities/CompanyMaterialTopic";
import { CompanyKpi } from "../entities/CompanyKpi";
import { KpiAssignment } from "../entities/KpiAssignment";
import { KpiTopicGrant } from "../entities/KpiTopicGrant";
import { KpiTopicAssignment } from "../entities/KpiTopicAssignment";
import { KpiTemplatePlan } from "../entities/KpiTemplatePlan";
import { KpiTarget } from "../entities/KpiTarget"; // KPI-9
import { BrandPalette } from "../entities/BrandPalette"; // DS-3
import { BrandFont, BrandFontFile } from "../entities/BrandFont"; // PE-2
import { StudioTemplate } from "../entities/StudioTemplate"; // DS-4
import { StudioLayout } from "../entities/StudioLayout"; // DS-4
import { StudioElement } from "../entities/StudioElement"; // DS-4
import { StudioAsset } from "../entities/StudioAsset"; // DS-4
import { StudioReportDoc } from "../entities/StudioReportDoc"; // DS-5
import { StudioReportDocVersion } from "../entities/StudioReportDocVersion"; // DS-5
import { StudioReportJob } from "../entities/StudioReportJob"; // DS-11
import { StudioReportShare } from "../entities/StudioReportShare"; // DS-11
import { StudioImageJob } from "../entities/StudioImageJob"; // PE-1
import { StudioAiCall } from "../entities/StudioAiCall"; // DS-9
import { StudioReportComment } from "../entities/StudioReportComment"; // DS-13
import { StudioReportApproval } from "../entities/StudioReportApproval"; // DS-13
import { StudioDataBaseline } from "../entities/StudioDataBaseline"; // DS-13
import { InsightEvent } from "../entities/InsightEvent"; // IN-4
import { InsightAiCall } from "../entities/InsightAiCall"; // IN-9
import { RecalculationEvent } from "../entities/RecalculationEvent"; // S3-14
import { ProductSale } from "../entities/ProductSale";
import { Supplier } from "../entities/Supplier";
import { SupplierFactor } from "../entities/SupplierFactor";
import { SupplierFacilityData } from "../entities/SupplierFacilityData";
import { PeriodLock } from "../entities/PeriodLock"; // S3-15
import { NothingThisMonth } from "../entities/NothingThisMonth"; // S3-15
import { installPgTypeParsers } from "./pgTypes";
dotenv.config();

// #191: bigint ids, count(*) and other int8 values come back as numbers, not strings.
// Before the DataSource below is created.
installPgTypeParsers();

const isProduction = process.env.NODE_ENV === "production";

const makeSync = process.env.TYPEORM_SYNC === "true";

// Shared entities array
const entities = [
    Company,
    Country,
    Site,
    User,
    Category,
    EmissionFactor,
    Emission,
    ColumnConfig,
    ColumnEntity,
    Unit,
    Product,
    ProductionData,
    EmissionDocument,
    EmissionCategoryMapping,
    AuditLog,
    Notification,
    Brand,
    EmissionThreshold,
    MaterialFactor,
    PcfStudy,
    PcfInput,
    PcfAllocation,
    PcfResult,
    SupplierRequest,
    McpToolCall,
    ImportPlan,
    ImportPlanRow,
    ImportPlanMatch,
    ImportMappingProfile,
    OauthClient,
    OauthGrant,
    OauthCode,
    OauthToken,
    CompanyScope3Category,
    CategoryGhgMapProposal,
    Investment, // S3-11
    Scope3ScreeningInput, // S3-12
    FxRate, // S3-5
    PriceDeflator, // S3-5
    CompanyBaseYear, // S3-14
    RecalculationEvent, // S3-14
    ProductSale, // S3-10
    // S3-6
    Supplier,
    SupplierFactor,
    SupplierFacilityData,
    PeriodLock, // S3-15
    NothingThisMonth, // S3-15
    // KPI-2
    KpiFramework,
    KpiDefinition,
    KpiDisclosure,
    KpiDisclosureMap,
    // KPI-4
    KpiValue,
    KpiValueEvidence,
    KpiPeriodLock,
    // KPI-3
    CompanyKpiSettings,
    CompanyFramework,
    CompanyMaterialTopic,
    CompanyKpi,
    KpiAssignment,
    KpiTopicGrant,
    KpiTopicAssignment,
    KpiTemplatePlan,
    KpiTarget,
    BrandPalette, // DS-3
    StudioTemplate, StudioLayout, StudioElement, StudioAsset, // DS-4
    StudioReportDoc, // DS-5
    StudioReportDocVersion, // DS-5
    StudioReportJob, StudioReportShare, // DS-11
    StudioAiCall, // DS-9
    StudioReportComment, StudioReportApproval, StudioDataBaseline, // DS-13
    StudioImageJob, // PE-1
    BrandFont, BrandFontFile, // PE-2
    InsightEvent, // IN-4
    InsightAiCall, // IN-9
];

/**
 * F-14 (22 Oct 2026): an optional session time zone, e.g. DB_TIMEZONE=UTC. A database server set
 * to another zone (a local Postgres in Asia/Calcutta) otherwise writes now() into the
 * `timestamp without time zone` columns in its own zone, and the app reads them back shifted.
 * Unset: the server's own setting, exactly as before.
 */
const sessionTimezone = (): { options?: string } => {
    const tz = (process.env.DB_TIMEZONE || "").trim();
    return /^[A-Za-z0-9_+\-/]+$/.test(tz) ? { options: `-c timezone=${tz}` } : {};
};

// Parse DATABASE_URL to extract connection parameters
const parseDbUrl = (url: string) => {
    const regex = /postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/;
    const match = url.match(regex);
    if (!match) return null;

    // Remove query params from database name
    const dbName = match[5].split("?")[0];

    return {
        username: match[1],
        password: match[2],
        host: match[3],
        port: parseInt(match[4]),
        database: dbName,
    };
};

// Build configuration based on environment
const getDataSourceConfig = (): DataSourceOptions => {
    // Production: Use DATABASE_URL connection string
    if (isProduction && process.env.DATABASE_URL) {
        const dbParams = parseDbUrl(process.env.DATABASE_URL);

        if (dbParams) {
            // Use explicit parameters for production
            return {
                type: "postgres",
                host: dbParams.host,
                port: dbParams.port,
                username: dbParams.username,
                password: dbParams.password,
                database: dbParams.database,
                synchronize: makeSync, // Never auto-sync in production
                logging: ["error"],
                entities,
                ssl: { rejectUnauthorized: false }, // Accept managed DB certs (self-signed/internal CA)
                // Handle pool-level connection errors (e.g. ECONNRESET on idle clients)
                poolErrorHandler: (err: any) => {
                    console.error("Database pool error:", err.message || err);
                },
                extra: {
                    // Connection pool configuration
                    max: 20, // Maximum number of connections in pool
                    connectionTimeoutMillis: 10000, // Return error after 10s if connection cannot be established
                    idleTimeoutMillis: 30000, // Close & remove clients which have been idle > 30 seconds
                    statement_timeout: 30000, // Statement timeout 30 seconds
                    // Keep connection alive — prevents ECONNRESET from idle connection drops
                    keepAlive: true,
                    keepAliveInitialDelayMillis: 10000,
                    ...sessionTimezone(),
                },
            };
        }

        // Fallback to URL if parsing fails
        return {
            type: "postgres",
            url: process.env.DATABASE_URL,
            synchronize: makeSync,
            logging: ["error"],
            entities,
            ssl: { rejectUnauthorized: false },
            poolErrorHandler: (err: any) => {
                console.error("Database pool error:", err.message || err);
            },
            extra: {
                max: 20,
                connectionTimeoutMillis: 10000,
                idleTimeoutMillis: 30000,
                keepAlive: true,
                keepAliveInitialDelayMillis: 10000,
                ...sessionTimezone(),
            },
        } as DataSourceOptions;
    }

    // Development: Use individual connection parameters
    return {
        type: "postgres",
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || "5433"),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        synchronize: makeSync, // Opt-in only via TYPEORM_SYNC=true. Left on, TypeORM rewrites
        // the schema to match entities on boot, which mangles restored-dump tables that have
        // no corresponding entity (activity_data, final_emission, invoice, uploaded_documents...).
        logging: false,
        entities,
        // Enable SSL if connecting to a managed DB (host is not localhost)
        ssl:
            process.env.DB_HOST &&
            !["localhost", "127.0.0.1"].includes(process.env.DB_HOST)
                ? { rejectUnauthorized: false }
                : false,
        extra: {
            max: 10,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            keepAlive: true,
            ...sessionTimezone(),
        },
    };
};

export const AppDataSource = new DataSource(getDataSourceConfig());
