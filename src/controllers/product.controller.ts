import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Product } from "../entities/Product";
import { Site } from "../entities/Site";
import { AuditLog } from "../entities/AuditLog";
import { ProductionData } from "../entities/ProductionData";
import { AuthRequest } from "../middlewares/auth.middleware";
import { pcfDataChanged } from "../pcf/staleness";

const repo = AppDataSource.getRepository(Product);
const siteRepo = AppDataSource.getRepository(Site);

/** A product with its site's client cut down to id and name. */
const withClient = (p: Product | null) => {
  if (!p?.site?.company) return p;
  const { company_id, name } = p.site.company;
  return { ...p, site: { ...p.site, company: { company_id, name } } };
};

/** A positive integer id from a body or URL value, else null. */
const idOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Trimmed string, or "" for anything that isn't one. */
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// Admin: Create product (Superadmin only)
export const createProduct = async (req: Request, res: Response) => {
  try {
    const { name, description, unit, site_id } = req.body;

    if (!text(name) || !text(unit) || !site_id) {
      return res.status(400).json({
        message: "name, unit, and site_id are required",
      });
    }
    if (!idOf(site_id)) return res.status(400).json({ message: "Choose a site that exists." });

    const site = await siteRepo.findOne({ where: { site_id: idOf(site_id)! } });
    if (!site) {
      return res.status(400).json({ message: "Choose a site that exists." });
    }

    const product = repo.create({
      name: text(name),
      description: description?.trim() || null,
      unit: text(unit),
      site: { site_id: idOf(site_id)! },
    });

    await repo.save(product);

    const savedProduct = await repo.findOne({
      where: { product_id: product.product_id },
      relations: ["site", "site.company"],
    });

    return res.status(201).json({
      message: "Product created successfully",
      product: withClient(savedProduct),
    });
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: Get all products, with each one's client and production record count
// and latest period (P25 list).
export const getProducts = async (_req: Request, res: Response) => {
  try {
    const products = await repo.find({
      relations: ["site", "site.company"],
      order: { name: "ASC" },
    });
    const stats: { product_id: number; production_count: number; last_period_end: string | null }[] = await AppDataSource.query(
      `SELECT product_id, COUNT(*)::int AS production_count, to_char(MAX(end_date), 'YYYY-MM-DD') AS last_period_end
         FROM production_data
        GROUP BY product_id`
    );
    const byId = new Map(stats.map((r) => [Number(r.product_id), r]));
    return res.status(200).json(
      products.map((p) => ({
        ...withClient(p),
        production_count: byId.get(p.product_id)?.production_count ?? 0,
        last_period_end: byId.get(p.product_id)?.last_period_end ?? null,
      }))
    );
  } catch (error) {
    console.error("Fetch products error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: A product's most recent production records, newest period first (P25 drawer).
export const getProductProduction = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid product id" });
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 100);
    const product = await repo.findOne({ where: { product_id: id } });
    if (!product) return res.status(404).json({ message: "Product not found" });

    const records = await AppDataSource.getRepository(ProductionData)
      .createQueryBuilder("pd")
      .leftJoin("pd.site", "site")
      .select([
        "pd.production_id",
        "pd.quantity",
        "pd.unit",
        "pd.start_date",
        "pd.end_date",
        "pd.status",
        "pd.created_at",
        "site.site_id",
        "site.name",
      ])
      .where("pd.product_id = :id", { id })
      .orderBy("pd.end_date", "DESC")
      .addOrderBy("pd.production_id", "DESC")
      .take(limit)
      .getMany();
    const total = await AppDataSource.getRepository(ProductionData).count({ where: { product: { product_id: id } } });

    return res.status(200).json({ total, records });
  } catch (error) {
    console.error("Fetch product production error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: Get product by ID
export const getProductById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const product = await repo.findOne({
      where: { product_id: parseInt(id) },
      relations: ["site"],
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json(product);
  } catch (error) {
    console.error("Fetch product by ID error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: Update product. Moving it to another site of the same client moves
// its production records with it, so they keep counting for the site the
// product is on. Each moved record gets an audit row.
export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const id = idOf(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid product id" });
    const { name, description, unit, site_id } = req.body;

    if (name !== undefined && !text(name)) return res.status(400).json({ message: "Name can't be empty." });
    if (unit !== undefined && !text(unit)) return res.status(400).json({ message: "Default unit can't be empty." });
    const toSite = site_id === undefined || site_id === null ? null : idOf(site_id);
    if (site_id !== undefined && site_id !== null && !toSite) return res.status(400).json({ message: "Choose a site that exists." });

    let movedIds: number[] = [];
    let fromSiteId: number | null = null;
    // Returned from the transaction as an HTTP error instead of throwing.
    const problem = await AppDataSource.transaction(async (m): Promise<[number, string] | null> => {
      // Lock the product so two moves can't interleave.
      const product = await m.getRepository(Product).findOne({
        where: { product_id: id },
        relations: ["site", "site.company"],
        lock: { mode: "pessimistic_write", tables: ["product"] },
      });
      if (!product) return [404, "Product not found"];
      fromSiteId = product.site?.site_id ?? null;
      const moving = toSite !== null && toSite !== fromSiteId;
      if (moving) {
        const target = await m.getRepository(Site).findOne({ where: { site_id: toSite }, relations: ["company"] });
        if (!target) return [400, "Choose a site that exists."];
        if (target.company?.company_id !== product.site?.company?.company_id) {
          return [400, "A product can only move to another site of the same client."];
        }
        product.site = { site_id: toSite } as Site;
      }
      if (text(name)) product.name = text(name);
      if (description !== undefined) product.description = description?.trim() || null;
      if (text(unit)) product.unit = text(unit);
      await m.getRepository(Product).save(product);

      if (moving) {
        const raw = await m.query(`UPDATE production_data SET site_id = $1 WHERE product_id = $2 RETURNING production_id`, [toSite, id]);
        // node-postgres returns [rows, count] for UPDATE ... RETURNING through TypeORM
        const rows: { production_id: number }[] = Array.isArray(raw[0]) ? raw[0] : raw;
        movedIds = rows.map((r) => r.production_id);
        if (movedIds.length) {
          const audit = m.getRepository(AuditLog);
          await audit.save(
            movedIds.map((pid) =>
              audit.create({
                entity_type: "production_data",
                entity_id: pid,
                action: "product_site_move",
                changed_fields: { site_id: { old: fromSiteId, new: toSite } },
                reason: `Product ${id} moved to another site`,
                changed_by: (req.user?.userId ? { user_id: req.user.userId } : null) as any,
              }),
            ),
          );
        }
      }
      return null;
    });
    if (problem) return res.status(problem[0]).json({ message: problem[1] });

    // Footprints at the old site that used these rows are now out of date.
    if (movedIds.length) await pcfDataChanged("production", movedIds);

    const updatedProduct = await repo.findOne({
      where: { product_id: id },
      relations: ["site", "site.company"],
    });

    return res.status(200).json({
      message: "Product updated successfully",
      product: withClient(updatedProduct),
      moved_production_count: movedIds.length,
    });
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: Delete product
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const product = await repo.findOne({
      where: { product_id: parseInt(id) },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Its production goes with it, which changes the site's mass total for other products' footprints.
    const productionIds: number[] = (
      await AppDataSource.query(`SELECT production_id FROM production_data WHERE product_id = $1`, [product.product_id])
    ).map((r: { production_id: number }) => r.production_id);
    await repo.delete({ product_id: parseInt(id) });
    await pcfDataChanged("production", productionIds);

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// User: Get products by site
export const getProductsBySite = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;

    const products = await repo.find({
      where: { site: { site_id: parseInt(siteId) } },
      relations: ["site"],
      order: { name: "ASC" },
    });

    return res.status(200).json(products);
  } catch (error) {
    console.error("Fetch products by site error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
