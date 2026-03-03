import { AppDataSource } from "../config/data-source";
import { In } from "typeorm";
import { Site } from "../entities/Site";
import { MasterData, MasterDataType, MasterDataStatus } from "../entities/MasterData";
import { SiteMasterData } from "../entities/SiteMasterData";
import { SiteUnit } from "../entities/SiteUnit";
import { UnitMaster } from "../entities/UnitMaster";

export class MasterDataService {
    private static masterDataRepo = AppDataSource.getRepository(MasterData);
    private static siteMasterDataRepo = AppDataSource.getRepository(SiteMasterData);
    private static siteUnitRepo = AppDataSource.getRepository(SiteUnit);
    private static siteRepo = AppDataSource.getRepository(Site);
    private static unitMasterRepo = AppDataSource.getRepository(UnitMaster);

    /**
     * Assigns all Active Master Data nodes to a Site and sets default Units for KPIs.
     * @param siteId The ID of the site to assign data to.
     */
    static async assignMasterDataToSite(siteId: number) {
        try {
            const site = await this.siteRepo.findOne({ where: { site_id: siteId } });
            if (!site) {
                console.error(`MasterDataService: Site ${siteId} not found.`);
                return;
            }

            console.log(`Assigning Master Data to Site: ${site.name} (ID: ${siteId})`);

            // 1. Fetch Active Master Data
            const allMasterData = await this.masterDataRepo.find({ where: { status: MasterDataStatus.ACTIVE } });
            if (allMasterData.length === 0) {
                console.warn("MasterDataService: No Active Master Data found.");
                return;
            }

            // 2. Assign to SiteMasterData
            let assignedCount = 0;
            for (const node of allMasterData) {
                const exists = await this.siteMasterDataRepo.findOne({
                    where: {
                        site: { site_id: siteId },
                        masterData: { id: node.id }
                    }
                });

                if (!exists) {
                    await this.siteMasterDataRepo.save(this.siteMasterDataRepo.create({
                        site: site,
                        masterData: node,
                        is_active: true
                    }));
                    assignedCount++;
                }
            }
            console.log(`   -> Assigned ${assignedCount} new Master Data nodes.`);

            // 3. Assign Default Units to SiteUnit (for KPIs)
            const kpis = allMasterData.filter(m => m.type === MasterDataType.KPI_FIELD);

            // Fetch default unit (first one)
            const units = await this.unitMasterRepo.find({ order: { id: "ASC" }, take: 1 });
            const defaultUnit = units.length > 0 ? units[0].shortName : "NA";

            let unitCount = 0;

            for (const kpi of kpis) {
                const unitToAssign = defaultUnit;

                const unitExists = await this.siteUnitRepo.findOne({
                    where: {
                        site: { site_id: siteId },
                        masterData: { id: kpi.id }
                    }
                });

                if (!unitExists) {
                    await this.siteUnitRepo.save(this.siteUnitRepo.create({
                        site: site,
                        masterData: kpi,
                        unit: unitToAssign
                    }));
                    unitCount++;
                }
            }
            console.log(`   -> Assigned Default Units to ${unitCount} new KPIs.`);

        } catch (error) {
            console.error("MasterDataService Error:", error);
            throw error;
        }
    }

    /**
     * Syncs Master Data and Units for a Site (Edit Popup).
     * @param siteId
     * @param items List of items containing master_data_id, is_active, and unit (for KPIs)
     */
    static async syncMasterDataForSite(
        siteId: number,
        items: { master_data_id: number; is_active: boolean; unit?: string }[]
    ) {
        const site = await this.siteRepo.findOne({ where: { site_id: siteId } });
        if (!site) throw new Error("Site not found");

        for (const item of items) {
            // A. Update/Create SiteMasterData (Visibility)
            let smd = await this.siteMasterDataRepo.findOne({
                where: { site: { site_id: siteId }, masterData: { id: item.master_data_id } }
            });

            if (smd) {
                smd.is_active = item.is_active;
                await this.siteMasterDataRepo.save(smd);
            } else {
                // Determine master data exists?
                smd = this.siteMasterDataRepo.create({
                    site,
                    masterData: { id: item.master_data_id } as MasterData, // partial ref
                    is_active: item.is_active
                });
                await this.siteMasterDataRepo.save(smd);
            }

            // B. Update/Create SiteUnit (If unit provided or needs default)

            // Check if it's a KPI field (this check is imperfect without fetching MD type, but safe enough if frontend logic is correct)
            // Ideally we'd check if (smd.masterData.type === KPI) but we only have ID here.
            // Using a simple check: if "unit" is provided OR we are enabling it newly.

            let unitToSave = item.unit;
            if (!unitToSave && item.is_active) {
                // If enabling and no unit provided, try to find existing or set default
                let existingUnit = await this.siteUnitRepo.findOne({
                    where: { site: { site_id: siteId }, masterData: { id: item.master_data_id } }
                });

                if (!existingUnit || !existingUnit.unit) {
                    // Fetch default if not exists OR unit is missing
                    const units = await this.unitMasterRepo.find({ order: { id: "ASC" }, take: 1 });
                    if (units.length > 0) unitToSave = units[0].shortName;
                }
            }

            if (unitToSave) {
                let su = await this.siteUnitRepo.findOne({
                    where: { site: { site_id: siteId }, masterData: { id: item.master_data_id } }
                });

                if (su) {
                    su.unit = unitToSave;
                    await this.siteUnitRepo.save(su);
                } else {
                    su = this.siteUnitRepo.create({
                        site,
                        masterData: { id: item.master_data_id } as MasterData, // partial ref
                        unit: unitToSave
                    });
                    await this.siteUnitRepo.save(su);
                }
            }
        }
    }

    static async getSiteMasterData(siteId: number, categoryId?: number, subcategoryIds?: number[]) {
        // Fetch all Master Data, enrich with Site Assignment Status and Unit
        // Relations depth: KPI (5) -> DataHeading (4) -> SubHeading (3) -> SubCat (2) -> Cat (1)
        // We need 4 levels of parents to reach Category from KPI
        const allMasterData = await this.masterDataRepo.find({
            order: { sequence: "ASC", id: "ASC" },
            relations: ["parent", "parent.parent", "parent.parent.parent", "parent.parent.parent.parent"]
        });

        const assignments = await this.siteMasterDataRepo.find({ where: { site: { site_id: siteId } }, relations: ["masterData"] });
        const units = await this.siteUnitRepo.find({ where: { site: { site_id: siteId } }, relations: ["masterData"] });

        const assignmentMap = new Map(assignments.map(a => [a.masterData.id, a.is_active]));
        const unitMap = new Map(units.map(u => [u.masterData.id, u.unit]));

        let filteredData = allMasterData;

        // Filter by Category
        if (categoryId) {
            filteredData = filteredData.filter(node =>
                node.id === categoryId ||
                node.parent?.id === categoryId ||
                node.parent?.parent?.id === categoryId ||
                node.parent?.parent?.parent?.id === categoryId ||
                node.parent?.parent?.parent?.parent?.id === categoryId
            );
        }

        // Filter by Subcategories
        if (subcategoryIds && subcategoryIds.length > 0) {
            // Include if node IS one of the subcategories, or DESCENDANT of one
            filteredData = filteredData.filter(node =>
                subcategoryIds.includes(node.id) ||
                (node.parent && subcategoryIds.includes(node.parent.id)) ||
                (node.parent?.parent && subcategoryIds.includes(node.parent.parent.id)) ||
                (node.parent?.parent?.parent && subcategoryIds.includes(node.parent.parent.parent.id)) ||
                (node.parent?.parent?.parent?.parent && subcategoryIds.includes(node.parent.parent.parent.parent.id))
            );
        }

        return filteredData.map(node => ({
            ...node,
            is_active: assignmentMap.has(node.id) ? assignmentMap.get(node.id) : false,
            assigned_unit: unitMap.get(node.id) || null
        }));
    }

    /**
     * Fetches only the Active Master Data assigned to a Site, including necessary ancestors for hierarchy navigation.
     * @param siteId
     */
    static async getAssignedSiteMasterData(siteId: number) {
        // 1. Get all active assignments for the site (KPIs usually)
        const assignments = await this.siteMasterDataRepo.find({
            where: {
                site: { site_id: siteId },
                is_active: true
            },
            relations: ["masterData"]
        });

        if (assignments.length === 0) return [];

        const assignedIds = new Set(assignments.map(a => a.masterData.id));

        // 2. We need to fetch the assigned items AND their full ancestry
        // Since TypeORM's tree repository methods (findAncestors) can be slow or tricky with relations,
        // and our depth is fixed/shallow (5 levels), we can fetch all Active Master Data and filter in memory,
        // OR fetch the assigned items with deep relations and collect parent IDs.

        // Fetching assigned items with deep parents:
        const assignedItems = await this.masterDataRepo.find({
            where: { id: In(Array.from(assignedIds)) },
            relations: ["parent", "parent.parent", "parent.parent.parent", "parent.parent.parent.parent"]
        });

        // Collect all unique IDs (assigned items + all ancestors)
        const allRelevantIds = new Set<number>();

        assignedItems.forEach(item => {
            allRelevantIds.add(item.id);
            let curr = item.parent;
            while (curr) {
                allRelevantIds.add(curr.id);
                curr = curr.parent;
            }
        });

        // 3. Fetch the full objects for all relevant IDs to ensure complete structure
        // We fetching "all" master data (which is cached/small usually) or just by IDs.
        // Fetching by IDs is safer.
        const relevantData = await this.masterDataRepo.findByIds(Array.from(allRelevantIds));

        // Re-attach relations? Since we need to traverse down or up?
        // Actually, SingleDataEntryForm needs `parent` references on the children to filter by parentId.
        // `findByIds` might not attach deep parents unless requested.
        // Let's manually reconstruct or just fetch with relations again for these IDs.

        const finalData = await this.masterDataRepo.find({
            where: { id: In(Array.from(allRelevantIds)) },
            relations: ["parent", "parent.parent", "parent.parent.parent", "parent.parent.parent.parent"],
            order: { sequence: "ASC", id: "ASC" }
        });

        const unitMap = new Map();
        const units = await this.siteUnitRepo.find({ where: { site: { site_id: siteId } }, relations: ["masterData"] });
        units.forEach(u => unitMap.set(u.masterData.id, u.unit));

        return finalData.map(node => ({
            ...node,
            is_active: assignedIds.has(node.id), // Only true if explicitly assigned, though ancestors are needed for nav
            assigned_unit: unitMap.get(node.id) || null
        }));
    }
}
