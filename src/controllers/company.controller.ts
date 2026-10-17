import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Company } from "../entities/Company";
import { stampCompanyOnboarded } from "../utils/companyOnboarded";
import { Site } from "../entities/Site";
import { clearClientStatusCache, closeInactiveClientStreams } from "../services/clientStatus";
import { deleteClient, describeHistory } from "../services/clientDelete";
import { FY_START_MONTH, FISCAL_YEAR_RULE } from "../reporting/ghg-data";
import { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { resolveUserCompanyId } from "../utils/companyScope";
import { ENTRY_DETAILS, EntryDetailSchema } from "../scope3/contracts/schemas";
import { SUPPORTED_CURRENCIES, supportedCurrency } from "../scope3/spend/currencies";

const repo = AppDataSource.getRepository(Company);

export const createCompany = async (req: Request, res: Response) => {
  const company = repo.create(req.body as Partial<Company>);
  await repo.save(company);
  await stampCompanyOnboarded(company.company_id);
  res.status(201).json(company);
};

/** Superadmins see every company; everyone else only their own. */
export const getCompanies = async (req: AuthRequest, res: Response) => {
  if (req.user?.role === UserRole.SUPERADMIN) {
    return res.json(await repo.find());
  }
  const companyId = await resolveUserCompanyId(req.user?.userId);
  res.json(companyId ? await repo.find({ where: { company_id: companyId } }) : []);
};

export const updateCompany = async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if ("status" in body && typeof body.status !== "boolean") {
    return res.status(400).json({ message: "status must be true or false" });
  }
  if ("mcp_enabled" in body && typeof body.mcp_enabled !== "boolean") {
    return res.status(400).json({ message: "mcp_enabled must be true or false" });
  }
  if ("ai_import_enabled" in body && typeof body.ai_import_enabled !== "boolean") {
    return res.status(400).json({ message: "ai_import_enabled must be true or false" });
  }
  // S3-15 part 2 (D9): drafts, submit and the month lock for this client.
  if ("review_workflow_v2" in body && typeof body.review_workflow_v2 !== "boolean") {
    return res.status(400).json({ message: "review_workflow_v2 must be true or false" });
  }
  // SE-2 (simple data entry): the currency a spend row takes when it names none, and how much of
  // the calculation the client's Users see where they enter data ("total" or "full").
  if ("default_currency" in body) {
    const currency = supportedCurrency(body.default_currency);
    if (!currency || String(body.default_currency).trim() !== currency) {
      return res.status(400).json({ code: "FIELD_INVALID", field: "default_currency", message: `default_currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}` });
    }
  }
  if ("entry_detail" in body && !EntryDetailSchema.safeParse(body.entry_detail).success) {
    return res.status(400).json({ code: "FIELD_INVALID", field: "entry_detail", message: `entry_detail must be ${ENTRY_DETAILS.join(" or ")}` });
  }
  await repo.update(req.params.id, body);
  // Deactivating (or reactivating) a client takes effect on the next request.
  if ("status" in body) clearClientStatusCache();
  if (body.status === false) {
    const id = Number(req.params.id);
    // Live notification streams don't pass through authenticate; end them.
    void closeInactiveClientStreams(id).catch((error) =>
      console.error(`Could not close notification streams of deactivated client ${id}:`, error),
    );
  }
  res.json({ message: "Company updated" });
};

/**
 * DELETE /admin/companies/:id — deletes a client and its setup, only while it
 * has no reporting history (see services/clientDelete). 409 with the counts
 * otherwise, so the page can offer deactivation instead.
 */
export const deleteCompany = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid client id" });
  const result = await deleteClient(id);
  if (result.status === "not_found") return res.status(404).json({ message: "Client not found" });
  if (result.status === "has_history") {
    return res.status(409).json({
      code: "CLIENT_HAS_HISTORY",
      message: `This client has reporting history (${describeHistory(result.history)}), so it can't be deleted. Deactivate it instead.`,
      history: result.history,
    });
  }
  if (result.status === "blocked") {
    return res.status(409).json({
      code: "CLIENT_DELETE_BLOCKED",
      message: "Other records still refer to this client's people or sites, so it wasn't deleted. Deactivate it instead.",
    });
  }
  clearClientStatusCache();
  return res.json({ message: "Client deleted", removed: result.removed });
};

/**
 * The reporting calendar (where the financial year starts). Deliberately does
 * NOT depend on resolving a company: it is a system-wide rule, and sites without
 * a company would otherwise 404 and leave the UI unable to build FY periods.
 */
export const getReportingCalendar = async (_req: Request, res: Response) => {
  return res.status(200).json({
    fiscalYearStartMonth: FY_START_MONTH,
    fiscalYearRule: FISCAL_YEAR_RULE,
  });
};

export const getCompanyNameBySites = async (req: Request, res: Response) => {
  try {
    const { siteIds } = req.body;

    if (!siteIds || !Array.isArray(siteIds) || siteIds.length === 0) {
      return res.status(400).json({ message: "Site IDs are required" });
    }

    const siteRepository = AppDataSource.getRepository(Site);

    const site = await siteRepository.findOne({
      where: { site_id: siteIds[0] },
      relations: ["company"],
    });

    if (!site || !site.company) {
      return res.status(404).json({ message: "Company not found for the provided sites" });
    }

    // fiscalYearStartMonth lets the UI build FY month/quarter options from the
    // backend's single definition instead of hardcoding its own copy.
    return res.status(200).json({
      companyName: site.company.name,
      fiscalYearStartMonth: FY_START_MONTH,
      fiscalYearRule: FISCAL_YEAR_RULE,
    });
  } catch (error) {
    console.error("Error fetching company name:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};