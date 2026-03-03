import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import {
  ColumnConfig,
  ColumnOptionsMap,
  ColumnDependencies,
  DependentOptionsMap,
  EmissionCategoryMapping,
} from "../entities/ColumnConfig";
import { Category } from "../entities/Category";
import { Site } from "../entities/Site";
import { ColumnEntity } from "../entities/Column";
import { In, IsNull } from "typeorm";

const repo = AppDataSource.getRepository(ColumnConfig);
const categoryRepo = AppDataSource.getRepository(Category);
const siteRepo = AppDataSource.getRepository(Site);
const columnRepo = AppDataSource.getRepository(ColumnEntity);

export const getColumnConfigs = async (_req: Request, res: Response) => {
  try {
    const columnConfigs = await repo.find({
      relations: ["site", "category", "columns"],
      order: { config_name: "ASC" },
    });

    return res.status(200).json(columnConfigs);
  } catch (error) {
    console.error("Fetch column configs error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getColumnConfigById = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const columnConfig = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category", "columns"],
    });

    if (!columnConfig) {
      return res.status(404).json({
        message: "Column config not found",
      });
    }

    return res.status(200).json(columnConfig);
  } catch (error) {
    console.error("Fetch column config error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getColumnConfigsByCategory = async (req: Request, res: Response) => {
  try {
    const { categoryId }: any = req.params;

    const columnConfigs = await repo.find({
      where: { category: { category_id: parseInt(categoryId) } },
      relations: ["site", "category", "columns"],
      order: { config_name: "ASC" },
    });

    return res.status(200).json(columnConfigs);
  } catch (error) {
    console.error("Fetch column configs by category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getColumnConfigsBySite = async (req: Request, res: Response) => {
  try {
    const { siteId }: any = req.params;

    const columnConfigs = await repo.find({
      where: { site: { site_id: parseInt(siteId) } },
      relations: ["site", "category", "columns"],
      order: { config_name: "ASC" },
    });

    return res.status(200).json(columnConfigs);
  } catch (error) {
    console.error("Fetch column configs by site error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getColumnConfigsBySiteAndCategory = async (req: Request, res: Response) => {
  try {
    const { siteId, categoryId }: any = req.params;

    const columnConfigs = await repo.find({
      where: {
        site: { site_id: parseInt(siteId) },
        category: { category_id: parseInt(categoryId) },
      },
      relations: ["site", "category", "columns"],
      order: { config_name: "ASC" },
    });

    return res.status(200).json(columnConfigs);
  } catch (error) {
    console.error("Fetch column configs by site and category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const createColumnConfig = async (req: Request, res: Response) => {
  try {
    const {
      config_name,
      site_id,
      category_id,
      column_ids,
      column_options,
      column_dependencies,
      dependent_options,
      emission_category_mapping,
    } = req.body;

    if (!config_name || !category_id) {
      return res.status(400).json({
        message: "config_name and category_id are required",
      });
    }

    // Validate site exists if provided
    let site = null;
    if (site_id) {
      site = await siteRepo.findOne({
        where: { site_id },
      });

      if (!site) {
        return res.status(400).json({
          message: "Site not found",
        });
      }
    }

    // Validate category exists
    const category = await categoryRepo.findOne({
      where: { category_id },
    });

    if (!category) {
      return res.status(400).json({
        message: "Category not found",
      });
    }

    // Check for duplicate config name within the same site (or global) and category
    const where: any = {
      config_name: config_name.trim(),
      category: { category_id },
    };

    if (site) {
      where.site = { site_id };
    } else {
      where.site = IsNull(); // Import IsNull from typeorm
    }

    const existing = await repo.findOne({ where });

    if (existing) {
      return res.status(409).json({
        message: "Column config with this name already exists for this context",
      });
    }

    // Validate columns if provided
    let columns: ColumnEntity[] = [];
    if (column_ids && Array.isArray(column_ids) && column_ids.length > 0) {
      columns = await columnRepo.find({
        where: { pk_id: In(column_ids) },
      });

      if (columns.length !== column_ids.length) {
        return res.status(400).json({
          message: "One or more columns not found",
        });
      }
    }

    // Validate and set optional JSONB fields
    const validatedColumnOptions: ColumnOptionsMap = column_options && typeof column_options === "object" ? column_options : {};
    const validatedColumnDependencies: ColumnDependencies = column_dependencies && typeof column_dependencies === "object" ? column_dependencies : {};
    const validatedDependentOptions: DependentOptionsMap = dependent_options && typeof dependent_options === "object" ? dependent_options : {};
    const validatedEmissionCategoryMapping: EmissionCategoryMapping = emission_category_mapping && typeof emission_category_mapping === "object" ? emission_category_mapping : {};

    const columnConfig = repo.create({
      config_name: config_name.trim(),
      site: site || undefined, // undefined leads to null in nullable column
      category: { category_id },
      columns,
      column_options: validatedColumnOptions,
      column_dependencies: validatedColumnDependencies,
      dependent_options: validatedDependentOptions,
      emission_category_mapping: validatedEmissionCategoryMapping,
    });

    await repo.save(columnConfig);

    // Fetch with relations for response
    const savedConfig = await repo.findOne({
      where: { pk_id: columnConfig.pk_id },
      relations: ["site", "category", "columns"],
    });

    return res.status(201).json({
      message: "Column config created successfully",
      columnConfig: savedConfig,
    });
  } catch (error) {
    console.error("Create column config error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const updateColumnConfig = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const {
      config_name,
      site_id,
      category_id,
      column_ids,
      column_options,
      column_dependencies,
      dependent_options,
      emission_category_mapping,
    } = req.body;

    if (
      config_name === undefined &&
      site_id === undefined &&
      category_id === undefined &&
      column_ids === undefined &&
      column_options === undefined &&
      column_dependencies === undefined &&
      dependent_options === undefined &&
      emission_category_mapping === undefined
    ) {
      return res.status(400).json({
        message: "At least one field is required for update",
      });
    }

    const columnConfig = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category", "columns"],
    });

    if (!columnConfig) {
      return res.status(404).json({
        message: "Column config not found",
      });
    }

    // Validate site if provided
    if (site_id !== undefined) {
      const site = await siteRepo.findOne({
        where: { site_id },
      });

      if (!site) {
        return res.status(400).json({
          message: "Site not found",
        });
      }
      columnConfig.site = site;
    }

    // Validate category if provided
    if (category_id !== undefined) {
      const category = await categoryRepo.findOne({
        where: { category_id },
      });

      if (!category) {
        return res.status(400).json({
          message: "Category not found",
        });
      }
      columnConfig.category = category;
    }

    // Check for duplicate config name
    if (config_name !== undefined) {
      const checkSiteId = site_id ?? (columnConfig.site ? columnConfig.site.site_id : null);
      const checkCategoryId = category_id ?? columnConfig.category.category_id;

      const where: any = {
        config_name: config_name.trim(),
        category: { category_id: checkCategoryId },
      };

      if (checkSiteId) {
        where.site = { site_id: checkSiteId };
      } else {
        where.site = IsNull();
      }

      const existing = await repo.findOne({ where });

      if (existing && existing.pk_id !== columnConfig.pk_id) {
        return res.status(409).json({
          message: "Column config with this name already exists for this site and category",
        });
      }
      columnConfig.config_name = config_name.trim();
    }

    // Update columns if provided
    if (column_ids !== undefined) {
      if (Array.isArray(column_ids) && column_ids.length > 0) {
        const columns = await columnRepo.find({
          where: { pk_id: In(column_ids) },
        });

        if (columns.length !== column_ids.length) {
          return res.status(400).json({
            message: "One or more columns not found",
          });
        }
        columnConfig.columns = columns;
      } else {
        columnConfig.columns = [];
      }
    }

    // Update JSONB fields if provided
    if (column_options !== undefined) {
      columnConfig.column_options = column_options === null ? {} : column_options;
    }

    if (column_dependencies !== undefined) {
      columnConfig.column_dependencies = column_dependencies === null ? {} : column_dependencies;
    }

    if (dependent_options !== undefined) {
      columnConfig.dependent_options = dependent_options === null ? {} : dependent_options;
    }

    if (emission_category_mapping !== undefined) {
      columnConfig.emission_category_mapping = emission_category_mapping === null ? {} : emission_category_mapping;
    }

    await repo.save(columnConfig);

    // Fetch with relations for response
    const updatedConfig = await repo.findOne({
      where: { pk_id: columnConfig.pk_id },
      relations: ["site", "category", "columns"],
    });

    return res.status(200).json({
      message: "Column config updated successfully",
      columnConfig: updatedConfig,
    });
  } catch (error) {
    console.error("Update column config error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const deleteColumnConfig = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const columnConfig = await repo.findOne({
      where: { pk_id: parseInt(id) },
    });

    if (!columnConfig) {
      return res.status(404).json({
        message: "Column config not found",
      });
    }

    await repo.delete({ pk_id: parseInt(id) });

    return res.status(200).json({
      message: "Column config deleted successfully",
    });
  } catch (error) {
    console.error("Delete column config error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Add or remove columns from a config
export const addColumnsToConfig = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { column_ids } = req.body;

    if (!column_ids || !Array.isArray(column_ids) || column_ids.length === 0) {
      return res.status(400).json({
        message: "column_ids array is required",
      });
    }

    const columnConfig = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["columns"],
    });

    if (!columnConfig) {
      return res.status(404).json({
        message: "Column config not found",
      });
    }

    const columnsToAdd = await columnRepo.find({
      where: { pk_id: In(column_ids) },
    });

    if (columnsToAdd.length !== column_ids.length) {
      return res.status(400).json({
        message: "One or more columns not found",
      });
    }

    // Add new columns (avoid duplicates)
    const existingIds = columnConfig.columns.map((c) => c.pk_id);
    const newColumns = columnsToAdd.filter((c) => !existingIds.includes(c.pk_id));
    columnConfig.columns = [...columnConfig.columns, ...newColumns];

    await repo.save(columnConfig);

    const updatedConfig = await repo.findOne({
      where: { pk_id: columnConfig.pk_id },
      relations: ["site", "category", "columns"],
    });

    return res.status(200).json({
      message: "Columns added successfully",
      columnConfig: updatedConfig,
    });
  } catch (error) {
    console.error("Add columns to config error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const removeColumnsFromConfig = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { column_ids } = req.body;

    if (!column_ids || !Array.isArray(column_ids) || column_ids.length === 0) {
      return res.status(400).json({
        message: "column_ids array is required",
      });
    }

    const columnConfig = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["columns"],
    });

    if (!columnConfig) {
      return res.status(404).json({
        message: "Column config not found",
      });
    }

    // Remove specified columns
    columnConfig.columns = columnConfig.columns.filter(
      (c) => !column_ids.includes(c.pk_id)
    );

    await repo.save(columnConfig);

    const updatedConfig = await repo.findOne({
      where: { pk_id: columnConfig.pk_id },
      relations: ["site", "category", "columns"],
    });

    return res.status(200).json({
      message: "Columns removed successfully",
      columnConfig: updatedConfig,
    });
  } catch (error) {
    console.error("Remove columns from config error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
