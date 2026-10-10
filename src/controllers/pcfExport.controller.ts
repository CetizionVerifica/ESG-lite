// Declaration export (C05): GET /pcf/studies/:id/export?format=pdf-data|pact|csv
// pdf-data feeds the front end's branded PDF; pact is a PACT v3
// ProductFootprint, checked against the published schema before it is sent;
// csv is a spreadsheet of the same figures. Licensed factor values are
// withheld from every format (src/pcf/declaration.ts).
import { Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { AuthRequest } from "../middlewares/auth.middleware";
import { PcfResult } from "../entities/PcfResult";
import { MaterialFactor } from "../entities/MaterialFactor";
import { Site } from "../entities/Site";
import { pcfScope } from "../pcf/access";
import type { PcfEngineInput, PcfLine, Dqr } from "../pcf/engine/computePcf";
import {
  buildDeclaration,
  DeclarationError,
  DeclarationSource,
  EXPORT_FORMATS,
  ExportFormat,
  toCsv,
  toPact,
  validatePact,
} from "../pcf/declaration";
import { loadStudy } from "./pcf.controller";

const idParam = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

// The domain in PACT URNs: the company's email domain, else the app's host.
function issuerDomain(email: string | null): string {
  const fromEmail = email?.split("@")[1]?.trim().toLowerCase();
  if (fromEmail && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(fromEmail)) return fromEmail;
  try {
    const host = new URL(process.env.FRONTEND_URL || "").hostname;
    if (host) return host;
  } catch {}
  return "esglite.app";
}

const fileStem = (name: string, id: number, version: number) =>
  `${name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "footprint"}-${id}-v${version}`;

export const exportStudy = async (req: AuthRequest, res: Response) => {
  try {
    const format = String(req.query.format ?? "pdf-data") as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) return res.status(400).json({ message: `format must be one of ${EXPORT_FORMATS.join(", ")}` });
    const scope = await pcfScope(req);
    const id = idParam(req.params.id);
    const study = id ? await loadStudy(id, scope) : null;
    if (!study) return res.status(404).json({ message: "Footprint not found" });
    const result = await AppDataSource.getRepository(PcfResult).findOne({ where: { study: { pcf_study_id: study.pcf_study_id } } });
    if (!result) return res.status(409).json({ message: "Calculate the footprint first" });

    const site = await AppDataSource.getRepository(Site).findOne({ where: { site_id: study.site.site_id }, relations: ["country"] });
    const input = (result.factor_snapshot as unknown as { input?: PcfEngineInput } | null)?.input ?? null;
    const mfIds = (input?.factors ?? []).filter((f) => f.id.startsWith("mf-")).map((f) => Number(f.id.slice(3)));
    const years = mfIds.length
      ? await AppDataSource.getRepository(MaterialFactor).find({ where: { material_factor_id: In(mfIds) }, select: ["material_factor_id", "source_year"] })
      : [];
    const cut = (result.cut_off ?? {}) as {
      below_threshold_ids?: string[];
      below_threshold_total_pct?: number;
      within_limit?: boolean;
      dqr?: Dqr & { overall: number };
      lines?: PcfLine[];
      allocation?: { share_pct: number; product_output_units: number } | null;
      warnings?: string[];
    };

    const src: DeclarationSource = {
      study: {
        id: study.pcf_study_id,
        version: study.version,
        status: study.status,
        standard: study.standard,
        boundary: study.boundary,
        pcr_tag: study.pcr_tag,
        allocation_key: study.allocation_key,
        cut_off_rule_pct: Number(study.cut_off_rule_pct),
        reference_start: study.reference_start,
        reference_end: study.reference_end,
        year_type: study.year_type,
        reviewed_at: study.reviewed_at ? new Date(study.reviewed_at) : null,
        reviewed_by: study.reviewed_by?.name ?? null,
        parent_version_id: study.parent_version?.pcf_study_id ?? null,
      },
      company: { id: study.company.company_id, name: study.company.name, email: study.company.email ?? null },
      product: {
        id: study.product.product_id,
        name: study.product.name,
        description: study.product.description ?? null,
        declared_unit: study.product.declared_unit,
        declared_unit_qty: num(study.product.declared_unit_qty),
        mass_per_unit_kg: num(study.product.mass_per_unit_kg),
      },
      site: {
        id: study.site.site_id,
        name: study.site.name,
        country_code: site?.country?.code?.trim().toUpperCase() ?? null,
        country_name: site?.country?.name ?? null,
      },
      result: {
        total_kg_per_unit: Number(result.total_kg_per_unit),
        by_stage: result.by_stage,
        lines: cut.lines ?? [],
        primary_data_share_pct: Number(result.primary_data_share_pct),
        dqr: cut.dqr ?? null,
        cut_off:
          cut.within_limit === undefined
            ? null
            : { below_threshold_ids: cut.below_threshold_ids ?? [], below_threshold_total_pct: cut.below_threshold_total_pct ?? 0, within_limit: cut.within_limit },
        allocation: cut.allocation ?? null,
        warnings: cut.warnings ?? [],
        calculated_at: new Date(result.calculated_at),
        engine_version: result.engine_version,
        input,
      },
      factor_years: Object.fromEntries(years.map((f) => [`mf-${f.material_factor_id}`, f.source_year])),
      issuer_domain: issuerDomain(study.company.email ?? null),
      generated_at: new Date(),
    };

    const declaration = buildDeclaration(src);
    const stem = fileStem(study.product.name, study.pcf_study_id, study.version);
    if (format === "pdf-data") return res.json({ declaration, file_name: `${stem}.pdf` });
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${stem}${declaration.draft ? "-DRAFT" : ""}.csv"`);
      return res.send(toCsv(declaration));
    }
    const pact = toPact(src, declaration);
    const errors = validatePact(pact);
    if (errors.length) {
      console.error("exportStudy: PACT document failed the schema", study.pcf_study_id, errors);
      return res.status(500).json({ message: "The PACT file did not pass the PACT v3 schema; nothing was exported" });
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${stem}.pact.json"`);
    return res.send(JSON.stringify(pact, null, 2));
  } catch (err) {
    if (err instanceof DeclarationError) return res.status(err.status).json({ message: err.message });
    console.error("exportStudy", err);
    res.status(500).json({ message: "Could not export the footprint" });
  }
};
