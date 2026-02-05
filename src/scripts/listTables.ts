import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function inspectTables() {
    const client = new Client({
        host: '13.202.10.42',
        port: 5432,
        user: 'postgres',
        password: 'toor',
        database: 'root_db',
        ssl: false
    });

    try {
        await client.connect();
        console.log('✅ Connected to DB');

        try {
            const resCompanies = await client.query(`SELECT * FROM companies LIMIT 1`);
            console.log('--- Table: companies ---');
            console.log(resCompanies.rows[0] ? Object.keys(resCompanies.rows[0]) : 'Empty Table');
        } catch (e: any) { console.log('Error reading companies:', e.message); }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

inspectTables();
