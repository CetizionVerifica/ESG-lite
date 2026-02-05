
import { getOldDbClient, getNewDbDataSource } from "./migrationConfig";
import { migrateSpecificCompany } from "./specificCompanyMigration";

const migrateAllCompanies = async () => {
    const oldDb = await getOldDbClient();
    // Ensure New DB is initialized for the specific calls
    await getNewDbDataSource();

    try {
        console.log("Starting Bulk Company Migration...");

        // Fetch all emails from Old DB
        const res = await oldDb.query(`SELECT email FROM companies WHERE is_delete = false ORDER BY id ASC`);
        console.log(`Found ${res.rows.length} companies to migrate.`);

        for (const row of res.rows) {
            if (row.email) {
                console.log(`\n--- Processing: ${row.email} ---`);
                await migrateSpecificCompany(row.email);
            }
        }

        console.log("\nBulk Company Migration Completed.");

    } catch (error) {
        console.error("Bulk Migration Error:", error);
    } finally {
        await oldDb.end();
        if ((await getNewDbDataSource()).isInitialized) {
            (await getNewDbDataSource()).destroy();
        }
    }
};

// Execute
migrateAllCompanies();
