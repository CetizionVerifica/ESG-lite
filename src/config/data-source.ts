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
import { MasterData } from "../entities/MasterData";
import dotenv from "dotenv";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const makeSync = process.env.TYPEORM_SYNC === "true";

// Allow self-signed certificates for managed database services in production
if (isProduction) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

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
  MasterData,
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
        ssl: true, // Enable SSL for managed databases
      };
    }

    // Fallback to URL if parsing fails
    return {
      type: "postgres",
      url: process.env.DATABASE_URL,
      synchronize: makeSync,
      logging: ["error"],
      entities,
      ssl: true,
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
    synchronize: true, // OK for development only
    logging: false,
    entities,
  };
};

export const AppDataSource = new DataSource(getDataSourceConfig());
