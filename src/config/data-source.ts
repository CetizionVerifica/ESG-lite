import "reflect-metadata";
import { DataSource } from "typeorm";
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
import dotenv from "dotenv";
dotenv.config();


export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5433"),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: true, // ❗ turn OFF in production
  logging: false,
  entities: [
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
  ],
});
