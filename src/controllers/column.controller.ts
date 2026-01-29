import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { ColumnEntity } from "../entities/Column";

const repo = AppDataSource.getRepository(ColumnEntity);

export const getColumns = async (_req: Request, res: Response) => {
  try {
    const columns = await repo.find({
      relations: ["columnConfigs"],
      order: { column_name: "ASC" },
    });

    return res.status(200).json(columns);
  } catch (error) {
    console.error("Fetch columns error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getColumnById = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const column = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["columnConfigs"],
    });

    if (!column) {
      return res.status(404).json({
        message: "Column not found",
      });
    }

    return res.status(200).json(column);
  } catch (error) {
    console.error("Fetch column error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const createColumn = async (req: Request, res: Response) => {
  try {
    const { column_name, column_type } = req.body;

    if (!column_name || !column_type) {
      return res.status(400).json({
        message: "column_name and column_type are required",
      });
    }

    // Check for duplicate column name
    const existing = await repo.findOne({
      where: { column_name: column_name.trim() },
    });

    if (existing) {
      return res.status(409).json({
        message: "Column with this name already exists",
      });
    }

    const column = repo.create({
      column_name: column_name.trim(),
      column_type: column_type.trim(),
    });

    await repo.save(column);

    return res.status(201).json({
      message: "Column created successfully",
      column,
    });
  } catch (error) {
    console.error("Create column error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const updateColumn = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { column_name, column_type } = req.body;

    if (column_name === undefined && column_type === undefined) {
      return res.status(400).json({
        message: "At least one field (column_name or column_type) is required",
      });
    }

    const column = await repo.findOne({
      where: { pk_id: parseInt(id) },
    });

    if (!column) {
      return res.status(404).json({
        message: "Column not found",
      });
    }

    // Check for duplicate column name (exclude current)
    if (column_name !== undefined) {
      const existing = await repo.findOne({
        where: { column_name: column_name.trim() },
      });

      if (existing && existing.pk_id !== parseInt(id)) {
        return res.status(409).json({
          message: "Column with this name already exists",
        });
      }
      column.column_name = column_name.trim();
    }

    if (column_type !== undefined) {
      column.column_type = column_type.trim();
    }

    await repo.save(column);

    return res.status(200).json({
      message: "Column updated successfully",
      column,
    });
  } catch (error) {
    console.error("Update column error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const deleteColumn = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const column = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["columnConfigs"],
    });

    if (!column) {
      return res.status(404).json({
        message: "Column not found",
      });
    }

    // Check if column is used in any config
    if (column.columnConfigs && column.columnConfigs.length > 0) {
      return res.status(400).json({
        message: "Cannot delete column that is associated with column configs",
        associatedConfigs: column.columnConfigs.map((c) => ({
          pk_id: c.pk_id,
          config_name: c.config_name,
        })),
      });
    }

    await repo.delete({ pk_id: parseInt(id) });

    return res.status(200).json({
      message: "Column deleted successfully",
    });
  } catch (error) {
    console.error("Delete column error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Get columns by type
export const getColumnsByType = async (req: Request, res: Response) => {
  try {
    const { type }: any = req.params;

    const columns = await repo.find({
      where: { column_type: type },
      relations: ["columnConfigs"],
      order: { column_name: "ASC" },
    });

    return res.status(200).json(columns);
  } catch (error) {
    console.error("Fetch columns by type error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk create columns
export const bulkCreateColumns = async (req: Request, res: Response) => {
  try {
    const { columns } = req.body;

    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({
        message: "columns array is required",
      });
    }

    // Validate all columns
    for (const col of columns) {
      if (!col.column_name || !col.column_type) {
        return res.status(400).json({
          message: "Each column must have column_name and column_type",
        });
      }
    }

    // Check for duplicates in request
    const names = columns.map((c: any) => c.column_name.trim());
    const uniqueNames = new Set(names);
    if (uniqueNames.size !== names.length) {
      return res.status(400).json({
        message: "Duplicate column names in request",
      });
    }

    // Check for existing columns
    const existingColumns = await repo.find();
    const existingNames = existingColumns.map((c) => c.column_name);
    const duplicates = names.filter((n: string) => existingNames.includes(n));

    if (duplicates.length > 0) {
      return res.status(409).json({
        message: "Some column names already exist",
        duplicates,
      });
    }

    const newColumns = columns.map((col: any) =>
      repo.create({
        column_name: col.column_name.trim(),
        column_type: col.column_type.trim(),
      })
    );

    await repo.save(newColumns);

    return res.status(201).json({
      message: "Columns created successfully",
      columns: newColumns,
    });
  } catch (error) {
    console.error("Bulk create columns error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
