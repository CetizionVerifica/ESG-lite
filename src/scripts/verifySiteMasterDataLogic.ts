
import { AppDataSource } from "../config/data-source";
import { MasterDataService } from "../services/masterData.service";
import { Site } from "../entities/Site";
import { Company } from "../entities/Company";
import { Country } from "../entities/Country";

const verifyLogic = async () => {
    try {
        await AppDataSource.initialize();
        console.log("✅ Database verified.");

        const siteRepo = AppDataSource.getRepository(Site);

        // 1. Setup: Get a Site (or create one)
        let site = await siteRepo.findOne({ where: { name: "Test_Verification_Site" } });
        if (!site) {
            // Need company/country first
            const company = await AppDataSource.getRepository(Company).findOne({ where: {} });
            const country = await AppDataSource.getRepository(Country).findOne({ where: {} });
            if (!company || !country) throw new Error("Need at least 1 company/country in DB");

            site = siteRepo.create({
                name: "Test_Verification_Site",
                address: "Test Address",
                contact_person: "Tester",
                company: company,
                country: country
            });
            await siteRepo.save(site);
            console.log("✅ Created Test Site:", site.site_id);
        } else {
            console.log("ℹ️ Using existing Test Site:", site.site_id);
        }

        const siteId = site.site_id;

        // 2. Test Assignment
        console.log("\n--- Testing Assignment ---");
        await MasterDataService.assignMasterDataToSite(siteId);
        console.log("✅ Assigned Master Data.");

        // 3. Test GET
        console.log("\n--- Testing GET ---");
        let data = await MasterDataService.getSiteMasterData(siteId);
        console.log(`✅ Fetched ${data.length} nodes.`);
        const sampleKPI = data.find(d => d.type === "KPI Field");
        if (sampleKPI) {
            console.log(`   Sample KPI: ${sampleKPI.title} (${sampleKPI.code}) -> Active: ${sampleKPI.is_active}, Unit: ${sampleKPI.assigned_unit}`);
        }

        // 4. Test SYNC (Update)
        console.log("\n--- Testing SYNC (Update) ---");
        if (sampleKPI) {
            const updatePayload = [{
                master_data_id: sampleKPI.id,
                is_active: true,
                unit: "TEST_UNIT_99" // Changed unit
            }];

            await MasterDataService.syncMasterDataForSite(siteId, updatePayload);
            console.log("✅ Synced update.");

            // Verify
            data = await MasterDataService.getSiteMasterData(siteId);
            const updatedKPI = data.find(d => d.id === sampleKPI.id);
            console.log(`   Updated KPI: ${updatedKPI?.title} -> Active: ${updatedKPI?.is_active}, Unit: ${updatedKPI?.assigned_unit}`);

            if (updatedKPI?.assigned_unit === "TEST_UNIT_99") {
                console.log("✅ Verification SUCCESS: Unit updated correctly.");
            } else {
                console.error("❌ Verification FAILED: Unit did not update.");
            }
        }

    } catch (error) {
        console.error("❌ Verification Error:", error);
    } finally {
        await AppDataSource.destroy();
    }
};

verifyLogic();
