import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Unit } from "../entities/Unit";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";

const repo = AppDataSource.getRepository(Unit);
const siteRepo = AppDataSource.getRepository(Site);
const categoryRepo = AppDataSource.getRepository(Category);

// Get all units
export const getUnits = async (_: Request, res: Response) => {
  try {
    const units = await repo.find({
      relations: ["site", "category"],
      order: { unit_id: "ASC" },
    });
    return res.status(200).json(units);
  } catch (error) {
    console.error("Fetch units error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get unit by ID
export const getUnitById = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const unit = await repo.findOne({
      where: { unit_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!unit) {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    return res.status(200).json(unit);
  } catch (error) {
    console.error("Fetch unit error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get units by site and category
export const getUnitsBySiteAndCategory = async (req: Request, res: Response) => {
  try {
    const { siteId, categoryId }: any = req.params;

    const units = await repo.find({
      where: {
        site: { site_id: parseInt(siteId) },
        category: { category_id: parseInt(categoryId) },
      },
      relations: ["site", "category"],
      order: { unit_name: "ASC" },
    });

    return res.status(200).json(units);
  } catch (error) {
    console.error("Fetch units by site and category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Create a new unit
export const createUnit = async (req: Request, res: Response) => {
  try {
    const { unit_name, description, site_id, category_id } = req.body;

    if (!unit_name || !site_id || !category_id) {
      return res.status(400).json({
        message: "unit_name, site_id, and category_id are required",
      });
    }

    // Validate site exists
    const site = await siteRepo.findOne({ where: { site_id } });
    if (!site) {
      return res.status(400).json({
        message: "Site not found",
      });
    }

    // Validate category exists
    const category = await categoryRepo.findOne({ where: { category_id } });
    if (!category) {
      return res.status(400).json({
        message: "Category not found",
      });
    }

    // Check for duplicate unit name for same site and category
    const existing = await repo.findOne({
      where: {
        unit_name: unit_name.trim(),
        site: { site_id },
        category: { category_id },
      },
    });

    if (existing) {
      return res.status(400).json({
        message: "Unit with this name already exists for this site and category",
      });
    }

    const unit = repo.create({
      unit_name: unit_name.trim(),
      description: description?.trim() || null,
      site: { site_id },
      category: { category_id },
    });

    await repo.save(unit);

    const savedUnit = await repo.findOne({
      where: { unit_id: unit.unit_id },
      relations: ["site", "category"],
    });

    return res.status(201).json({
      message: "Unit created successfully",
      unit: savedUnit,
    });
  } catch (error) {
    console.error("Create unit error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Update a unit
export const updateUnit = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { unit_name, description, site_id, category_id } = req.body;

    if (
      unit_name === undefined &&
      description === undefined &&
      site_id === undefined &&
      category_id === undefined
    ) {
      return res.status(400).json({
        message: "At least one field is required for update",
      });
    }

    const unit = await repo.findOne({
      where: { unit_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!unit) {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    // Validate site if provided
    if (site_id !== undefined) {
      const site = await siteRepo.findOne({ where: { site_id } });
      if (!site) {
        return res.status(400).json({
          message: "Site not found",
        });
      }
      unit.site = { site_id } as any;
    }

    // Validate category if provided
    if (category_id !== undefined) {
      const category = await categoryRepo.findOne({ where: { category_id } });
      if (!category) {
        return res.status(400).json({
          message: "Category not found",
        });
      }
      unit.category = { category_id } as any;
    }

    if (unit_name !== undefined) unit.unit_name = unit_name.trim();
    if (description !== undefined) unit.description = description?.trim() || null;

    await repo.save(unit);

    const updatedUnit = await repo.findOne({
      where: { unit_id: unit.unit_id },
      relations: ["site", "category"],
    });

    return res.status(200).json({
      message: "Unit updated successfully",
      unit: updatedUnit,
    });
  } catch (error) {
    console.error("Update unit error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Delete a unit
export const deleteUnit = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const unit = await repo.findOne({
      where: { unit_id: parseInt(id) },
    });

    if (!unit) {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    await repo.delete({ unit_id: parseInt(id) });

    return res.status(200).json({
      message: "Unit deleted successfully",
    });
  } catch (error) {
    console.error("Delete unit error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
