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
dotenv.config();

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
];

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
        },
    };
};

export const AppDataSource = new DataSource(getDataSourceConfig());
