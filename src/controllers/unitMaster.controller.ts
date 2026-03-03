import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { UnitMaster, UnitMasterStatus } from "../entities/UnitMaster";

const repo = AppDataSource.getRepository(UnitMaster);

export const createUnit = async (req: Request, res: Response) => {
    try {
        const { name, shortName, status } = req.body;

        if (!name || !shortName) {
            return res.status(400).json({ message: "Name and Short Name are required" });
        }

        const existing = await repo.findOne({ where: [{ name }, { shortName }] });
        if (existing) {
            return res.status(409).json({ message: "Unit with this name or short name already exists" });
        }

        const unit = repo.create({
            name,
            shortName,
            status: status || UnitMasterStatus.ACTIVE,
        });

        await repo.save(unit);
        return res.status(201).json(unit);
    } catch (error) {
        console.error("Create Unit Master error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const getUnits = async (req: Request, res: Response) => {
    try {
        const units = await repo.find({
            order: { name: "ASC" },
        });
        return res.json(units);
    } catch (error) {
        console.error("Get Unit Master error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const updateUnit = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, shortName, status } = req.body;

        const unit = await repo.findOne({ where: { id: parseInt(id as string) } });
        if (!unit) {
            return res.status(404).json({ message: "Unit not found" });
        }

        if (name && name !== unit.name) {
            const existing = await repo.findOne({ where: { name } });
            if (existing) return res.status(409).json({ message: "Unit name already exists" });
            unit.name = name;
        }

        if (shortName && shortName !== unit.shortName) {
            const existing = await repo.findOne({ where: { shortName } });
            if (existing) return res.status(409).json({ message: "Unit short name already exists" });
            unit.shortName = shortName;
        }

        if (status) unit.status = status;

        await repo.save(unit);
        return res.json(unit);
    } catch (error) {
        console.error("Update Unit Master error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const deleteUnit = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await repo.softDelete(id);
        if (result.affected === 0) {
            return res.status(404).json({ message: "Unit not found" });
        }
        return res.json({ message: "Deleted successfully" });
    } catch (error) {
        console.error("Delete Unit Master error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};
