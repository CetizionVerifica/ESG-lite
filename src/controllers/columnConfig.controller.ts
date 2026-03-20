import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import {
  ColumnConfig,
  ColumnOptionsMap,
  ColumnDependencies,
  DependentOptionsMap,
  EmissionCategoryMapping,
  ExtraFieldDefinition,
} from "../entities/ColumnConfig";
import { Category } from "../entities/Category";
import { Site } from "../entities/Site";
import { ColumnEntity } from "../entities/Column";
import { Unit } from "../entities/Unit";
import { In } from "typeorm";
import { generateColumnConfigProposal } from "../services/columnConfigGenerator";
import { getDefaultExtraFieldsByName } from "../utils/defaultExtraFields";

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
      extra_fields,
    } = req.body;

    if (!config_name || !site_id || !category_id) {
      return res.status(400).json({
        message: "config_name, site_id and category_id are required",
      });
    }

    // Validate site exists
    const site = await siteRepo.findOne({
      where: { site_id },
    });

    if (!site) {
      return res.status(400).json({
        message: "Site not found",
      });
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

    // Check for duplicate config name within the same site and category
    const existing = await repo.findOne({
      where: {
        config_name: config_name.trim(),
        site: { site_id },
        category: { category_id },
      },
    });

    if (existing) {
      return res.status(409).json({
        message: "Column config with this name already exists for this site and category",
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
    const validatedExtraFields: ExtraFieldDefinition[] = extra_fields && Array.isArray(extra_fields) && extra_fields.length > 0
      ? extra_fields
      : getDefaultExtraFieldsByName(category.category_name);

    const columnConfig = repo.create({
      config_name: config_name.trim(),
      site: { site_id },
      category: { category_id },
      columns,
      column_options: validatedColumnOptions,
      column_dependencies: validatedColumnDependencies,
      dependent_options: validatedDependentOptions,
      emission_category_mapping: validatedEmissionCategoryMapping,
      extra_fields: validatedExtraFields,
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
      extra_fields,
    } = req.body;

    if (
      config_name === undefined &&
      site_id === undefined &&
      category_id === undefined &&
      column_ids === undefined &&
      column_options === undefined &&
      column_dependencies === undefined &&
      dependent_options === undefined &&
      emission_category_mapping === undefined &&
      extra_fields === undefined
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
      const checkSiteId = site_id ?? columnConfig.site.site_id;
      const checkCategoryId = category_id ?? columnConfig.category.category_id;
      const existing = await repo.findOne({
        where: {
          config_name: config_name.trim(),
          site: { site_id: checkSiteId },
          category: { category_id: checkCategoryId },
        },
      });

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

    if (extra_fields !== undefined) {
      columnConfig.extra_fields = extra_fields === null ? [] : extra_fields;
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

// ─── Auto-Generate: Preview ─────────────────────────────────────────────────

export const previewAutoGenerateColumnConfig = async (req: Request, res: Response) => {
  try {
    const siteId = parseInt(req.query.site_id as string);
    const categoryId = parseInt(req.query.category_id as string);

    if (!siteId || !categoryId || isNaN(siteId) || isNaN(categoryId)) {
      return res.status(400).json({
        message: "site_id and category_id query params are required",
      });
    }

    const proposal = await generateColumnConfigProposal(siteId, categoryId);
    return res.status(200).json(proposal);
  } catch (error: any) {
    console.error("Auto-generate preview error:", error);

    if (error.message?.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }
    if (error.message?.includes("No emission factors")) {
      return res.status(404).json({ message: error.message });
    }

    return res.status(500).json({
      message: error.message || "Internal server error",
    });
  }
};

// ─── Auto-Generate: Confirm ─────────────────────────────────────────────────

export const confirmAutoGenerateColumnConfig = async (req: Request, res: Response) => {
  try {
    const {
      site_id,
      category_id,
      config_name,
      columns,
      column_options,
      column_dependencies,
      dependent_options,
      emission_category_mapping,
      create_units,
      proposed_units,
    } = req.body;

    if (!site_id || !category_id || !config_name) {
      return res.status(400).json({
        message: "site_id, category_id and config_name are required",
      });
    }

    // Validate site and category
    const site = await siteRepo.findOne({ where: { site_id } });
    if (!site) {
      return res.status(400).json({ message: "Site not found" });
    }

    const category = await categoryRepo.findOne({ where: { category_id } });
    if (!category) {
      return res.status(400).json({ message: "Category not found" });
    }

    // Check for duplicate config name
    const existing = await repo.findOne({
      where: {
        config_name: config_name.trim(),
        site: { site_id },
        category: { category_id },
      },
    });
    if (existing) {
      return res.status(409).json({
        message: "Column config with this name already exists for this site and category",
      });
    }

    // Create new column entities for any is_new columns
    const columnEntities: ColumnEntity[] = [];
    if (columns && Array.isArray(columns)) {
      for (const col of columns) {
        if (col.existing_id) {
          // Reuse existing column entity, or create new if renamed
          const existingCol = await columnRepo.findOne({
            where: { pk_id: col.existing_id },
          });
          if (existingCol) {
            if (col.column_name && col.column_name !== existingCol.column_name) {
              // User renamed — find or create a column with the new name
              let renamedCol = await columnRepo.findOne({
                where: { column_name: col.column_name },
              });
              if (!renamedCol) {
                renamedCol = columnRepo.create({
                  column_name: col.column_name,
                  column_type: col.column_type || existingCol.column_type,
                });
                await columnRepo.save(renamedCol);
              }
              columnEntities.push(renamedCol);
            } else {
              columnEntities.push(existingCol);
            }
          }
        } else if (col.is_new && col.column_name) {
          // Check if a column with this name was already created (avoid duplicates)
          let newCol = await columnRepo.findOne({
            where: { column_name: col.column_name },
          });
          if (!newCol) {
            newCol = columnRepo.create({
              column_name: col.column_name,
              column_type: col.column_type || "select",
            });
            await columnRepo.save(newCol);
          }
          columnEntities.push(newCol);
        }
      }
    }

    // Expand compressed options: strings → {id, label} objects.
    // The frontend compresses {id: "X", label: "X"} to just "X" to reduce payload size.
    const expandOptions = (opts: Record<string, any>): Record<string, any> => {
      const expanded: Record<string, any> = {};
      for (const [key, value] of Object.entries(opts)) {
        if (Array.isArray(value)) {
          expanded[key] = value.map((item: any) =>
            typeof item === "string" ? { id: item, label: item } : item
          );
        } else if (typeof value === "object" && value !== null) {
          expanded[key] = expandOptions(value);
        } else {
          expanded[key] = value;
        }
      }
      return expanded;
    };

    const expandedColumnOptions = column_options ? expandOptions(column_options) : {};
    const expandedDependentOptions = dependent_options ? expandOptions(dependent_options) : {};

    // Remap column_options keys from column names to column pk_ids.
    // The generator/frontend sends keys like "Waste Type", but the rest of
    // the app (UserDataEntry, ColumnConfigList) looks up by pk_id string.
    const remappedColumnOptions: Record<string, any> = {};
    if (expandedColumnOptions && typeof expandedColumnOptions === "object") {
      // Build name → pk_id lookup from the columns we just resolved
      const nameToPkId: Record<string, number> = {};
      if (columns && Array.isArray(columns)) {
        for (let i = 0; i < columns.length; i++) {
          const colDef = columns[i];
          const entity = columnEntities[i];
          if (colDef && entity) {
            nameToPkId[colDef.column_name] = entity.pk_id;
          }
        }
      }

      for (const [key, value] of Object.entries(expandedColumnOptions)) {
        // If key is a column name, remap to pk_id; otherwise keep as-is
        const pkId = nameToPkId[key];
        const newKey = pkId ? pkId.toString() : key;
        remappedColumnOptions[newKey] = value;
      }
    }

    // Create the column config (auto-populate extra_fields from defaults)
    const columnConfig = repo.create({
      config_name: config_name.trim(),
      site: { site_id },
      category: { category_id },
      columns: columnEntities,
      column_options: remappedColumnOptions,
      column_dependencies: column_dependencies || {},
      dependent_options: expandedDependentOptions || {},
      emission_category_mapping: emission_category_mapping || {},
      extra_fields: getDefaultExtraFieldsByName(category.category_name),
    });

    await repo.save(columnConfig);

    // Create units if requested
    const unitRepo = AppDataSource.getRepository(Unit);
    const unitsCreated: string[] = [];

    if (create_units && proposed_units && Array.isArray(proposed_units)) {
      for (const pu of proposed_units) {
        if (pu.already_exists) continue;

        // Check it doesn't already exist
        const existingUnit = await unitRepo.findOne({
          where: {
            unit_name: pu.unit_name,
            site: { site_id },
            category: { category_id },
          },
        });
        if (existingUnit) continue;

        const unit = unitRepo.create({
          unit_name: pu.unit_name,
          description: `Auto-generated from emission factor denominator unit`,
          site: { site_id } as any,
          category: { category_id } as any,
        });
        await unitRepo.save(unit);
        unitsCreated.push(pu.unit_name);
      }
    }

    // Fetch with relations for response
    const savedConfig = await repo.findOne({
      where: { pk_id: columnConfig.pk_id },
      relations: ["site", "category", "columns"],
    });

    return res.status(201).json({
      message: "Column config created successfully",
      columnConfig: savedConfig,
      units_created: unitsCreated,
    });
  } catch (error: any) {
    console.error("Auto-generate confirm error:", error);
    return res.status(500).json({
      message: error.message || "Internal server error",
    });
  }
};

// ─── Seed Extra Fields: Backfill all existing configs ───────────────────────

export const seedExtraFields = async (_req: Request, res: Response) => {
  try {
    const configs = await repo.find({
      relations: ["category"],
    });

    let updated = 0;
    let skipped = 0;

    for (const config of configs) {
      const categoryId = config.category?.category_id;
      if (!categoryId) {
        skipped++;
        continue;
      }

      // Skip configs that already have extra_fields populated
      if (config.extra_fields && Array.isArray(config.extra_fields) && config.extra_fields.length > 0) {
        skipped++;
        continue;
      }

      const defaults = getDefaultExtraFieldsByName(config.category.category_name);
      if (defaults.length === 0) {
        skipped++;
        continue;
      }

      config.extra_fields = defaults;
      await repo.save(config);
      updated++;
    }

    return res.status(200).json({
      message: `Seeded extra_fields for ${updated} configs, skipped ${skipped}`,
      updated,
      skipped,
      total: configs.length,
    });
  } catch (error: any) {
    console.error("Seed extra fields error:", error);
    return res.status(500).json({
      message: error.message || "Internal server error",
    });
  }
};
