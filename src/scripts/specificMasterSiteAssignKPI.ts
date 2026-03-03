
import { AppDataSource } from "../config/data-source";
import { Company } from "../entities/Company";
import { Site } from "../entities/Site";
import { MasterData, MasterDataType, MasterDataStatus } from "../entities/MasterData";
import { SiteMasterData } from "../entities/SiteMasterData";
import { SiteUnit } from "../entities/SiteUnit";
import * as dotenv from 'dotenv';

dotenv.config();

const assignMasterDataToSite = async (email: string) => {
    console.log(`🚀 Starting Master Data Assignment for: ${email}`);

    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
    }

    try {
        const companyRepo = AppDataSource.getRepository(Company);
        const siteRepo = AppDataSource.getRepository(Site);
        const masterDataRepo = AppDataSource.getRepository(MasterData);
        const siteMasterDataRepo = AppDataSource.getRepository(SiteMasterData);
        const siteUnitRepo = AppDataSource.getRepository(SiteUnit);

        // 1. Find Company
        const company = await companyRepo.findOne({ where: { email: email } });
        if (!company) {
            console.error(`❌ Company not found for email: ${email}`);
            return;
        }

        // 2. Find Site (Assume HQ or First Site)
        // We need to find the site associated with this company. 
        // For now, looking for the default HQ site or just the first one.
        const sites = await siteRepo.find({ where: { company: { company_id: company.company_id } } });
        if (sites.length === 0) {
            console.error(`❌ No site found for company: ${company.name}`);
            return;
        }
        const targetSite = sites[0]; // Picking the first one for now
        console.log(`✅ Targeted Site: ${targetSite.name} (ID: ${targetSite.site_id})`);

        // 3. Fetch Master Data
        const allMasterData = await masterDataRepo.find({ where: { status: MasterDataStatus.ACTIVE } });
        if (allMasterData.length === 0) {
            console.warn("⚠️  No Active Master Data found. Please run 'seedMasterData.ts' first.");
            return;
        }

        console.log(`ℹ️  Found ${allMasterData.length} Master Data nodes.`);

        // 4. Assign to SiteMasterData
        let assignedCount = 0;
        for (const node of allMasterData) {
            const exists = await siteMasterDataRepo.findOne({
                where: {
                    site: { site_id: targetSite.site_id },
                    masterData: { id: node.id }
                }
            });

            if (!exists) {
                await siteMasterDataRepo.save(siteMasterDataRepo.create({
                    site: targetSite,
                    masterData: node,
                    is_active: true
                }));
                assignedCount++;
            }
        }
        console.log(`   -> Assigned ${assignedCount} new Master Data nodes.`);

        // 5. Assign Units to SiteUnit (for KPIs)
        const kpis = allMasterData.filter(m => m.type === MasterDataType.KPI_FIELD);

        // Local Default Units Map
        const defaultUnits: Record<string, string> = {
            "302-1a-1": "kg", "302-1a-2": "Ltr", "302-1a-3": "kgs", "302-1a-4": "NA",
            "302-1b-1": "MT", "302-1b-2": "GJ", "302-1b-3": "NA", "302-1b-4": "NA",
            "302-1c-1": "Kwh", "302-1c-2": "Kwh", "302-1c-3": "Kwh", "302-1c-4": "Kwh"
        };

        let unitCount = 0;

        for (const kpi of kpis) {
            const unitToAssign = defaultUnits[kpi.code] || "NA";

            const unitExists = await siteUnitRepo.findOne({
                where: {
                    site: { site_id: targetSite.site_id },
                    masterData: { id: kpi.id }
                }
            });

            if (!unitExists) {
                await siteUnitRepo.save(siteUnitRepo.create({
                    site: targetSite,
                    masterData: kpi,
                    unit: unitToAssign
                }));
                unitCount++;
            }
        }
        console.log(`   -> Assigned Default Units to ${unitCount} new KPIs.`);
        console.log("✅ Assignment Process Completed.");

    } catch (error) {
        console.error("❌ Error during assignment:", error);
    } finally {
        if (AppDataSource.isInitialized) {
            await AppDataSource.destroy();
        }
    }
};

// CLI Execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const emailIndex = args.indexOf('--email');
    let email = null;

    if (emailIndex !== -1 && args[emailIndex + 1]) {
        email = args[emailIndex + 1];
    } else if (args.length > 0) {
        email = args[0];
    }

    if (email) {
        assignMasterDataToSite(email);
    } else {
        console.log("Usage: npx ts-node src/scripts/specificMasterSiteAssignKPI.ts --email <email>");
    }
}

export { assignMasterDataToSite };
