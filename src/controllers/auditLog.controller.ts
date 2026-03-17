import { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { AuditLog } from "../entities/AuditLog";
import { AuthRequest } from "../middlewares/auth.middleware";

const auditRepo = AppDataSource.getRepository(AuditLog);

export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    const { entity_type, entity_id } = req.query;

    if (!entity_type || !entity_id) {
      return res
        .status(400)
        .json({ message: "entity_type and entity_id are required" });
    }

    if (!["emission", "production_data"].includes(entity_type as string)) {
      return res.status(400).json({ message: "Invalid entity_type" });
    }

    const logs = await auditRepo.find({
      where: {
        entity_type: entity_type as "emission" | "production_data",
        entity_id: parseInt(entity_id as string),
      },
      relations: ["changed_by"],
      order: { changed_at: "DESC" },
    });

    const sanitized = logs.map((log) => ({
      id: log.id,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      action: log.action,
      changed_fields: log.changed_fields,
      changed_by: log.changed_by
        ? {
            user_id: log.changed_by.user_id,
            name: log.changed_by.name,
            email: log.changed_by.email,
            role: log.changed_by.role,
          }
        : null,
      changed_at: log.changed_at,
    }));

    return res.json(sanitized);
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
