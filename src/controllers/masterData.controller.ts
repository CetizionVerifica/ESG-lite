import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { MasterData, MasterDataType } from "../entities/MasterData";
import { Category } from "../entities/Category";
import { ColumnEntity } from "../entities/Column";

const repo = AppDataSource.getRepository(MasterData);
const categoryRepo = AppDataSource.getRepository(Category);
const columnRepo = AppDataSource.getRepository(ColumnEntity);

export const createMasterData = async (req: Request, res: Response) => {
    try {
        const {
            code,
            title,
            description,
            type,
            parent_id,
            kpi_field_placeholder,
            status,
            sequence,
        } = req.body;

        let parent = null;
        let level = 1;

        if (parent_id) {
            parent = await repo.findOne({ where: { id: parseInt(parent_id) } });
            if (!parent) {
                return res.status(400).json({ message: "Parent not found" });
            }
            level = parent.level + 1;
        }

        // Check for duplicate code
        const existing = await repo.findOne({ where: { code } });
        if (existing) {
            return res.status(409).json({ message: "Code already exists" });
        }

        const masterData = repo.create({
            code,
            title,
            description,
            type,
            parent: parent || undefined,
            level,
            kpi_field_placeholder: type === "KPI Field" ? kpi_field_placeholder : null,
            status,
            sequence,
        });

        await repo.save(masterData);

        // --- SYNC LOGIC ---
        // Auto-create Category or Column if they don't exist
        if (type === "Category") {
            const existingCategory = await categoryRepo.findOne({ where: { category_name: title } });
            if (!existingCategory) {
                const newCategory = categoryRepo.create({
                    category_name: title,
                    scope: "Scope 1" // Default for now
                });
                await categoryRepo.save(newCategory);
            }
        } else if (type === "KPI Field") {
            const existingColumn = await columnRepo.findOne({ where: { column_name: title } });
            if (!existingColumn) {
                const newColumn = columnRepo.create({
                    column_name: title,
                    column_type: "number" // Default for KPIs
                });
                await columnRepo.save(newColumn);
            }
        }
        // ------------------

        return res.status(201).json(masterData);
    } catch (error) {
        console.error("Create MasterData error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const getMasterData = async (req: Request, res: Response) => {
    try {
        const data = await repo.find({
            relations: ["parent"],
            order: { sequence: "ASC", id: "ASC" },
        });
        return res.json(data);
    } catch (error) {
        console.error("Get MasterData error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const updateMasterData = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        const {
            code,
            title,
            description,
            type,
            parent_id,
            kpi_field_placeholder,
            status,
            sequence,
        } = req.body;

        const masterData = await repo.findOne({ where: { id } });
        if (!masterData) {
            return res.status(404).json({ message: "Master Data not found" });
        }

        if (code && code !== masterData.code) {
            const existing = await repo.findOne({ where: { code } });
            if (existing) {
                return res.status(409).json({ message: "Code already exists" });
            }
            masterData.code = code;
        }

        if (title) masterData.title = title;
        if (description !== undefined) masterData.description = description;
        if (type) masterData.type = type;
        if (status) masterData.status = status;
        if (sequence !== undefined) masterData.sequence = sequence;
        if (type === "KPI Field" && kpi_field_placeholder !== undefined) {
            masterData.kpi_field_placeholder = kpi_field_placeholder;
        }

        // Handle parent change
        if (parent_id !== undefined) {
            if (parent_id === null) {
                masterData.parent = null;
                masterData.level = 1;
            } else {
                // Prevent setting self as parent
                if (parseInt(parent_id) === masterData.id) {
                    return res.status(400).json({ message: "Cannot set self as parent" });
                }

                const parent = await repo.findOne({ where: { id: parseInt(parent_id) } });
                if (!parent) {
                    return res.status(400).json({ message: "Parent not found" });
                }
                masterData.parent = parent;
                masterData.level = parent.level + 1;
            }
        }

        await repo.save(masterData);
        return res.json(masterData);
    } catch (error) {
        console.error("Update MasterData error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const deleteMasterData = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        const result = await repo.softDelete(id);
        if (result.affected === 0) {
            return res.status(404).json({ message: "Master Data not found" });
        }
        return res.json({ message: "Deleted successfully" });
    } catch (error) {
        console.error("Delete MasterData error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const seedDemoData = async (req: Request, res: Response) => {
    try {
        // 1. Environment (Category)
        let env = await repo.findOne({ where: { code: "ENV" } });
        if (!env) {
            env = repo.create({ code: "ENV", title: "Environment", type: MasterDataType.CATEGORY, level: 1 });
            await repo.save(env);
        }

        // 2. Energy (Subcategory)
        let energy = await repo.findOne({ where: { code: "302" } });
        if (!energy) {
            energy = repo.create({ code: "302", title: "Energy", type: MasterDataType.SUBCATEGORY, parent: env, level: 2 });
            await repo.save(energy);
        }

        // 3. 302-1 (Sub-heading / Standard)
        let std = await repo.findOne({ where: { code: "302-1" } });
        if (!std) {
            std = repo.create({ code: "302-1", title: "Energy consumption within the organization", type: MasterDataType.SUB_HEADING, parent: energy, level: 3 });
            await repo.save(std);
        }

        // 4. 302-1a (Data Heading) - Non-renewable
        let headingA = await repo.findOne({ where: { code: "302-1a" } });
        if (!headingA) {
            headingA = repo.create({ code: "302-1a", title: "Total non-renewable fuel energy consumption", type: MasterDataType.DATA_HEADING, parent: std, level: 4 });
            await repo.save(headingA);
        }

        // KPIs under 302-1a
        const kpisA = [
            { code: "302-1a-1", title: "Coal" },
            { code: "302-1a-2", title: "Diesel" },
            { code: "302-1a-3", title: "LPG for Canteen" },
            { code: "302-1a-4", title: "Other" },
        ];

        for (const k of kpisA) {
            if (!await repo.findOne({ where: { code: k.code } })) {
                await repo.save(repo.create({
                    code: k.code, title: k.title, type: MasterDataType.KPI_FIELD, parent: headingA, level: 5
                }));
            }
        }

        // 5. 302-1b (Data Heading) - Renewable
        let headingB = await repo.findOne({ where: { code: "302-1b" } });
        if (!headingB) {
            headingB = repo.create({ code: "302-1b", title: "Total renewable fuel energy consumption", type: MasterDataType.DATA_HEADING, parent: std, level: 4 });
            await repo.save(headingB);
        }

        // KPIs under 302-1b
        const kpisB = [
            { code: "302-1b-1", title: "Bio-Briquette" },
            { code: "302-1b-2", title: "Solar" },
            { code: "302-1b-3", title: "Wind" },
            { code: "302-1b-4", title: "Other" },
        ];

        for (const k of kpisB) {
            if (!await repo.findOne({ where: { code: k.code } })) {
                await repo.save(repo.create({
                    code: k.code, title: k.title, type: MasterDataType.KPI_FIELD, parent: headingB, level: 5
                }));
            }
        }

        // 6. 302-1c (Data Heading) - Total Energy on Categories
        let headingC = await repo.findOne({ where: { code: "302-1c" } });
        if (!headingC) {
            headingC = repo.create({ code: "302-1c", title: "Total energy consumption on these categories", type: MasterDataType.DATA_HEADING, parent: std, level: 4 });
            await repo.save(headingC);
        }

        // KPIs under 302-1c
        const kpisC = [
            { code: "302-1c-1", title: "Electricity" },
            { code: "302-1c-2", title: "Heating" },
            { code: "302-1c-3", title: "Cooling" },
            { code: "302-1c-4", title: "Steam" },
        ];

        for (const k of kpisC) {
            if (!await repo.findOne({ where: { code: k.code } })) {
                await repo.save(repo.create({
                    code: k.code, title: k.title, type: MasterDataType.KPI_FIELD, parent: headingC, level: 5
                }));
            }
        }

        return res.json({ message: "Demo data seeded successfully" });
    } catch (error) {
        console.error("Seed error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const getCategories = async (req: Request, res: Response) => {
    try {
        const categories = await repo.find({
            where: { level: 1, type: MasterDataType.CATEGORY },
            order: { sequence: "ASC", id: "ASC" },
        });
        return res.json(categories);
    } catch (error) {
        console.error("Get Categories error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const getSubcategories = async (req: Request, res: Response) => {
    try {
        const { categoryId } = req.query;
        if (!categoryId) {
            return res.status(400).json({ message: "CategoryId is required" });
        }

        const subcategories = await repo.find({
            where: {
                level: 2,
                type: MasterDataType.SUBCATEGORY,
                parent: { id: parseInt(categoryId as string) }
            },
            order: { sequence: "ASC", id: "ASC" },
        });
        return res.json(subcategories);
    } catch (error) {
        console.error("Get Subcategories error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};
