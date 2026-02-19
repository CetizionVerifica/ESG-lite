
import { DataSource } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Old DB Configuration (Source)
export const getOldDbClient = async () => {
    const client = new Client({
        host: process.env.OLD_DB_HOST || '13.202.10.42',
        port: parseInt(process.env.OLD_DB_PORT || '5432'),
        user: process.env.OLD_DB_USERNAME || 'postgres',
        password: process.env.OLD_DB_PASSWORD || 'toor',
        database: process.env.OLD_DB_NAME || 'root_db',
        ssl: false // Assuming source is not SSL enforced
    });

    await client.connect();
    console.log("Connected to Old DB (Source)");
    return client;
};

// Target DB is AppDataSource
export const getNewDbDataSource = async () => {
    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
        console.log("Connected to New DB (Target)");
    }
    return AppDataSource;
};
