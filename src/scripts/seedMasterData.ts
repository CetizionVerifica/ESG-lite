
import { AppDataSource } from "../config/data-source";
import { MasterData, MasterDataType, MasterDataStatus } from "../entities/MasterData";

async function seedMasterData() {
    console.log("🚀 Starting Master Data Seeding...");

    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
    }

    const repo = AppDataSource.getRepository(MasterData);

    try {
        // --- Helper Function ---
        const ensureNode = async (
            code: string,
            title: string,
            type: MasterDataType,
            level: number,
            parent?: MasterData
        ): Promise<MasterData> => {
            let node = await repo.findOne({ where: { code } });
            if (!node) {
                node = repo.create({
                    code,
                    title,
                    type,
                    level,
                    parent: parent,
                    status: MasterDataStatus.ACTIVE
                });
                await repo.save(node);
                console.log(`   + Created: [${type}] ${title} (${code})`);
            } else {
                // Optional: Update logic if needed
                // console.log(`   - Exists: [${type}] ${title} (${code})`);
            }
            return node;
        };

        // 1. Environment (Category - Level 1)
        const env = await ensureNode("ENV", "Environment", MasterDataType.CATEGORY, 1);

        // 2. Energy (Subcategory - Level 2)
        const energy = await ensureNode("302", "Energy", MasterDataType.SUBCATEGORY, 2, env);

        // ==========================================
        // 302-1 Energy consumption within the organization
        // ==========================================
        const std302_1 = await ensureNode("302-1", "Energy consumption within the organization", MasterDataType.SUB_HEADING, 3, energy);

        // 302-1a
        const heading1a = await ensureNode("302-1a", "Total non-renewable fuel energy consumption", MasterDataType.DATA_HEADING, 4, std302_1);
        await ensureNode("302-1a-1", "Coal", MasterDataType.KPI_FIELD, 5, heading1a);
        await ensureNode("302-1a-2", "Diesel", MasterDataType.KPI_FIELD, 5, heading1a);
        await ensureNode("302-1a-3", "LPG for Canteen", MasterDataType.KPI_FIELD, 5, heading1a);
        await ensureNode("302-1a-4", "Other", MasterDataType.KPI_FIELD, 5, heading1a);

        // 302-1b
        const heading1b = await ensureNode("302-1b", "Total renewable fuel energy consumption", MasterDataType.DATA_HEADING, 4, std302_1);
        await ensureNode("302-1b-1", "Bio-Briquette", MasterDataType.KPI_FIELD, 5, heading1b);
        await ensureNode("302-1b-2", "Solar", MasterDataType.KPI_FIELD, 5, heading1b);
        await ensureNode("302-1b-3", "Wind", MasterDataType.KPI_FIELD, 5, heading1b);
        await ensureNode("302-1b-4", "Other", MasterDataType.KPI_FIELD, 5, heading1b);

        // 302-1c
        const heading1c = await ensureNode("302-1c", "Total energy consumption on these categories", MasterDataType.DATA_HEADING, 4, std302_1);
        await ensureNode("302-1c-1", "Electricity", MasterDataType.KPI_FIELD, 5, heading1c);
        await ensureNode("302-1c-2", "Heating", MasterDataType.KPI_FIELD, 5, heading1c);
        await ensureNode("302-1c-3", "Cooling", MasterDataType.KPI_FIELD, 5, heading1c);
        await ensureNode("302-1c-4", "Steam", MasterDataType.KPI_FIELD, 5, heading1c);

        // 302-1d
        const heading1d = await ensureNode("302-1d", "Total energy sold on these categories", MasterDataType.DATA_HEADING, 4, std302_1);
        await ensureNode("302-1d-1", "Electricity", MasterDataType.KPI_FIELD, 5, heading1d);
        await ensureNode("302-1d-2", "Heating", MasterDataType.KPI_FIELD, 5, heading1d);
        await ensureNode("302-1d-3", "Cooling", MasterDataType.KPI_FIELD, 5, heading1d);
        await ensureNode("302-1d-4", "Steam", MasterDataType.KPI_FIELD, 5, heading1d);

        // 302-1e
        const heading1e = await ensureNode("302-1e", "Total energy consumption within the organization", MasterDataType.DATA_HEADING, 4, std302_1);
        await ensureNode("302-1e-1", "Total energy consumption within the organization", MasterDataType.KPI_FIELD, 5, heading1e);


        // ==========================================
        // 302-2 Energy consumption outside of the organization
        // ==========================================
        const std302_2 = await ensureNode("302-2", "Energy consumption outside of the organization", MasterDataType.SUB_HEADING, 3, energy);

        const heading2a = await ensureNode("302-2a", "Total energy consumption outside of the organization", MasterDataType.DATA_HEADING, 4, std302_2);
        await ensureNode("302-2a-1", "Total energy consumption", MasterDataType.KPI_FIELD, 5, heading2a);

        await ensureNode("302-2b", "Please describe the standards, methodologies, assumptions, and/or calculation tools used", MasterDataType.KPI_FIELD, 4, std302_2);
        await ensureNode("302-2c", "Source of the conversion factors used.", MasterDataType.KPI_FIELD, 4, std302_2);


        // ==========================================
        // 302-3 Energy intensity
        // ==========================================
        const std302_3 = await ensureNode("302-3", "Energy intensity", MasterDataType.SUB_HEADING, 3, energy);

        const heading3a = await ensureNode("302-3a", "Energy intensity ratio for the organization", MasterDataType.DATA_HEADING, 4, std302_3);
        await ensureNode("302-3a-1", "Total energy consumption per full-time employee", MasterDataType.KPI_FIELD, 5, heading3a);
        await ensureNode("302-3a-2", "Total energy consumption per USD Cr. Revenue from Operations", MasterDataType.KPI_FIELD, 5, heading3a);

        const heading3b = await ensureNode("302-3b", "Organization-specific metric (the denominator) chosen to calculate the ratio", MasterDataType.DATA_HEADING, 4, std302_3);
        await ensureNode("302-3b-1", "Full-time employee", MasterDataType.KPI_FIELD, 5, heading3b);
        await ensureNode("302-3b-2", "Revenue from Operations", MasterDataType.KPI_FIELD, 5, heading3b);

        await ensureNode("302-3c", "Please state types of energy included in the intensity ratio; whether fuel, electricity, heating, cooling, steam, or all.", MasterDataType.KPI_FIELD, 4, std302_3);
        await ensureNode("302-3d", "Please state the ratio uses energy consumption within the organization, outside of it, or both", MasterDataType.KPI_FIELD, 4, std302_3);


        // ==========================================
        // 302-4 Reduction of energy consumption
        // ==========================================
        const std302_4 = await ensureNode("302-4", "Reduction of energy consumption", MasterDataType.SUB_HEADING, 3, energy);

        const heading4a = await ensureNode("302-4a", "Description (Energy conserved, Type, Basis)", MasterDataType.DATA_HEADING, 4, std302_4);
        await ensureNode("302-4a-1", "Initiative 1", MasterDataType.KPI_FIELD, 5, heading4a);
        await ensureNode("302-4a-2", "Initiative 2", MasterDataType.KPI_FIELD, 5, heading4a);
        await ensureNode("302-4a-3", "Initiative 3", MasterDataType.KPI_FIELD, 5, heading4a);


        // ==========================================
        // 302-5 Reductions in energy requirements of products and services
        // ==========================================
        const std302_5 = await ensureNode("302-5", "Reductions in energy requirements of products and services", MasterDataType.SUB_HEADING, 3, energy);

        await ensureNode("302-5a", "Have there been any reductions in energy requirements of sold products and services during the reporting period? If yes, please state the amount in joules or multiples.", MasterDataType.KPI_FIELD, 4, std302_5);
        await ensureNode("302-5b", "Please state the basis for calculating reductions in energy consumption, such as base year or baseline, including the rational for choosing it.", MasterDataType.KPI_FIELD, 4, std302_5);
        await ensureNode("302-5c", "Please state all standards, methodologies, assumptions, and/or calculation tools used", MasterDataType.KPI_FIELD, 4, std302_5);


        console.log("✅ Master Data Seeding Completed for GRI 302 Energy.");

    } catch (error) {
        console.error("❌ Seeding Failed:", error);
    } finally {
        if (AppDataSource.isInitialized) {
            await AppDataSource.destroy();
        }
    }
}

// Execute if run directly
if (require.main === module) {
    seedMasterData();
}

export { seedMasterData };

