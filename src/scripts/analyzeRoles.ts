import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function analyzeRelationships() {
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

        console.log('--- Sample Company Record ---');
        const resComp = await client.query(`SELECT id, company_name, email FROM companies WHERE role='company' LIMIT 1`);
        console.log(resComp.rows[0]);

        console.log('\n--- Sample Employee Record ---');
        // Check columns that might link to company
        const resEmp = await client.query(`SELECT id, company_name, email, company_id, created_by_company_id, role, department FROM companies WHERE role='employee' LIMIT 1`);
        console.log(resEmp.rows[0]);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

analyzeRelationships();
