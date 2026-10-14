import { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { AuditLog } from "../../entities/AuditLog";
import { ImportMappingProfile } from "../../entities/ImportMappingProfile";
import { ImportPlan } from "../../entities/ImportPlan";
import { UserRole } from "../../types/type";
import { resolveUserCompanyId } from "../../utils/companyScope";
import { ImportError } from "../errors";
import { ListMappingProfilesQuerySchema, MappingProfile, MappingProposal, MappingProposalSchema, SheetProposal } from "../mapping";
import { BatchCommittedEvent, WriterContext } from "../writer";
import { buildWriterContext, isAiImportEnabled, TokenUser } from "../plans/scope";

/**
 * Mapping memory (XI3, docs/excel-import/modules/XI3-mapping-memory/CLAUDE.md).
 *
 * A profile is one confirmed sheet mapping of one company for one header
 * fingerprint, site and category. Everything here goes through the caller's
 * WriterContext: a profile is served only when its company is the caller's
 * and its site is one the caller may write to; anything else reads as 404,
 * as plans do, so ids can't be probed across clients. Learning happens only
 * when a bulk_upload plan that carried a confirmed proposal commits.
 */

type Query = Record<string, unknown>;

const repo = (m: EntityManager = AppDataSource.manager) => m.getRepository(ImportMappingProfile);

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export const profileView = (p: ImportMappingProfile): MappingProfile => ({
  id: p.id,
  company_id: Number(p.company_id),
  site_id: Number(p.site_id),
  category_id: p.category_id === null ? null : Number(p.category_id),
  fingerprint: p.fingerprint,
  sheet_proposal: p.sheet_proposal as SheetProposal,
  confirmed_by: p.confirmed_by === null ? null : Number(p.confirmed_by),
  confirmed_at: iso(p.confirmed_at),
  uses: Number(p.uses),
  created_at: iso(p.created_at) as string,
  updated_at: iso(p.updated_at) as string,
});

const assertAiImportEnabled = async (companyId: number) => {
  if (!(await isAiImportEnabled(companyId))) throw new ImportError("AI_IMPORT_DISABLED_FOR_CLIENT");
};

/**
 * `GET /imports/mapping-profiles?fingerprint=&site_id=` (+ `company_id` for a
 * Superadmin): the caller's company's profiles for that fingerprint and site,
 * newest confirmation first. The site must be one the caller may import into
 * (IMPORT_FORBIDDEN otherwise, as a plan row for it would be refused); the
 * client's smart-import switch must be on.
 */
export const listProfiles = async (user: TokenUser, rawQuery: Query): Promise<MappingProfile[]> => {
  const parsed = ListMappingProfilesQuerySchema.safeParse(rawQuery);
  if (!parsed.success) throw new ImportError("IMPORT_VALIDATION", parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })));
  const query = parsed.data;
  const ctx = await buildWriterContext(user, query.company_id);
  await assertAiImportEnabled(ctx.company_id);
  if (!ctx.allowed_site_ids.includes(query.site_id)) throw new ImportError("IMPORT_FORBIDDEN", { site_id: query.site_id });
  const rows = await repo().find({
    where: { company_id: ctx.company_id, site_id: query.site_id, fingerprint: query.fingerprint },
    order: { confirmed_at: "DESC", updated_at: "DESC" },
  });
  return rows.map(profileView);
};

/**
 * Loads one profile as the caller may see it: their own company's, on a site
 * in their scope (a Superadmin sees every client's). Anything else is 404.
 */
const loadVisibleProfile = async (user: TokenUser, id: string, m: EntityManager): Promise<{ profile: ImportMappingProfile; ctx: WriterContext }> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ImportError("IMPORT_PLAN_NOT_FOUND", undefined, "Mapping profile not found.");
  const profile = await repo(m).findOne({ where: { id } });
  if (!profile) throw new ImportError("IMPORT_PLAN_NOT_FOUND", undefined, "Mapping profile not found.");
  if (user.role !== UserRole.SUPERADMIN) {
    const own = await resolveUserCompanyId(Number(user.userId));
    if (own !== Number(profile.company_id)) throw new ImportError("IMPORT_PLAN_NOT_FOUND", undefined, "Mapping profile not found.");
  }
  const ctx = await buildWriterContext(user, Number(profile.company_id));
  if (!ctx.allowed_site_ids.includes(Number(profile.site_id))) throw new ImportError("IMPORT_PLAN_NOT_FOUND", undefined, "Mapping profile not found.");
  return { profile, ctx };
};

/**
 * `DELETE /imports/mapping-profiles/:id` ("Forget this mapping"): a
 * Superadmin, the client's Admin, or the Manager who confirmed it. A Manager
 * who holds the site but did not confirm the profile, and every User, get
 * IMPORT_FORBIDDEN; another client gets 404. The deletion is audited.
 */
export const deleteProfile = async (user: TokenUser, id: string): Promise<{ id: string; deleted: true }> => {
  await AppDataSource.transaction(async (m) => {
    const { profile, ctx } = await loadVisibleProfile(user, id, m);
    const mayDelete =
      ctx.role === UserRole.SUPERADMIN ||
      ctx.role === UserRole.ADMIN ||
      (ctx.role === UserRole.MANAGER && profile.confirmed_by !== null && Number(profile.confirmed_by) === ctx.user_id);
    if (!mayDelete) throw new ImportError("IMPORT_FORBIDDEN");
    await repo(m).delete({ id: profile.id });
    await writeAudit(m, ctx.user_id, "delete", profile, `Forgotten by ${ctx.role} ${ctx.user_id}`);
  });
  return { id, deleted: true };
};

// ---------- the plan side: validating and storing a confirmed proposal ----------

/**
 * `POST /imports/plans` with `mapping` (XI0 leaves it unknown): only a
 * bulk_upload plan may carry one, the client's switch must be on, it must
 * parse as a MappingProposal, and its site must be one the caller may import
 * into (never another client's, never a site a Manager does not hold). What
 * comes back is what gets stored on import_plan.mapping and learned on commit.
 */
export const validatePlanMapping = async (ctx: WriterContext, channel: string, raw: unknown): Promise<MappingProposal | null> => {
  if (raw === undefined || raw === null) return null;
  if (channel !== "bulk_upload") throw new ImportError("IMPORT_VALIDATION", [{ path: "mapping", message: "mapping is only accepted on bulk_upload plans" }]);
  await assertAiImportEnabled(ctx.company_id);
  const parsed = MappingProposalSchema.safeParse(raw);
  if (!parsed.success) throw new ImportError("IMPORT_VALIDATION", parsed.error.issues.slice(0, 20).map((i) => ({ path: ["mapping", ...i.path].join("."), message: i.message })));
  if (!ctx.allowed_site_ids.includes(parsed.data.site_id)) throw new ImportError("IMPORT_FORBIDDEN", { site_id: parsed.data.site_id });
  return parsed.data;
};

// ---------- learning on commit ----------

/** The part of a sheet proposal a profile keeps: the mapping, without the one-off save_mapping flags. */
export const toStoredSheet = (sheet: SheetProposal): SheetProposal => ({
  ...sheet,
  activities: sheet.activities.map(({ save_mapping: _dropped, ...a }) => ({ ...a, save_mapping: false })),
  excluded: false,
});

/**
 * Learn from a committed batch: for every sheet of the plan's confirmed
 * proposal (excluded sheets aside), upsert the company's profile for that
 * fingerprint, site and category with the confirmed mapping, `confirmed_by`
 * the committing user and `uses + 1`. Only bulk_upload plans that carried a
 * proposal teach anything; Claude and API plans never do. Never throws: a
 * failure here must not undo or report against a commit that succeeded.
 * Returns the number of profiles written.
 */
export const learnFromBatch = async (event: BatchCommittedEvent): Promise<number> => {
  if (event.channel !== "bulk_upload") return 0;
  const plan = await AppDataSource.getRepository(ImportPlan).findOne({ where: { upload_batch_id: event.upload_batch_id, status: "committed" } });
  if (!plan || !plan.mapping) return 0;
  const parsed = MappingProposalSchema.safeParse(plan.mapping);
  if (!parsed.success) {
    console.error(`Mapping memory: plan ${plan.plan_id} carries a proposal that no longer parses; nothing learned.`);
    return 0;
  }
  if (Number(plan.company_id) !== event.company_id) return 0; // never learn across companies
  let written = 0;
  for (const sheet of parsed.data.sheets) {
    if (sheet.excluded) continue;
    if (!event.site_ids.includes(sheet.site_id)) continue; // the batch wrote nothing for that site
    const categoryId = sheet.category.kind === "fixed" ? sheet.category.id : null;
    await AppDataSource.transaction(async (m) => {
      // Serialise upserts of one company × fingerprint (the unique key treats
      // NULL category_id as distinct, so the check below must not race).
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`import_mapping_profile:${plan.company_id}:${sheet.fingerprint}`]);
      const existing = await repo(m)
        .createQueryBuilder("p")
        .where("p.company_id = :company AND p.fingerprint = :fp AND p.site_id = :site AND p.category_id IS NOT DISTINCT FROM :cat", {
          company: plan.company_id,
          fp: sheet.fingerprint,
          site: sheet.site_id,
          cat: categoryId,
        })
        .getOne();
      const now = new Date();
      const stored = toStoredSheet(sheet);
      if (existing) {
        await repo(m).update({ id: existing.id }, { sheet_proposal: stored as any, confirmed_by: event.created_by, confirmed_at: now, uses: Number(existing.uses) + 1 });
        const after = (await repo(m).findOne({ where: { id: existing.id } }))!;
        await writeAudit(m, event.created_by, "update", after, `Learned from import plan ${plan.plan_id} (batch ${event.upload_batch_id})`, { uses: { old: Number(existing.uses), new: Number(after.uses) } });
      } else {
        const saved = await repo(m).save(
          repo(m).create({
            company_id: Number(plan.company_id),
            site_id: sheet.site_id,
            category_id: categoryId,
            fingerprint: sheet.fingerprint,
            sheet_proposal: stored,
            confirmed_by: event.created_by,
            confirmed_at: now,
            uses: 1,
          }),
        );
        await writeAudit(m, event.created_by, "create", saved, `Learned from import plan ${plan.plan_id} (batch ${event.upload_batch_id})`, { uses: { old: null, new: 1 } });
      }
      written += 1;
    });
  }
  return written;
};

/**
 * One audit_log row per profile write. audit_log.entity_id is an integer and
 * a profile id is a uuid, so the row carries 0 there and the id, company,
 * site, category and fingerprint in changed_fields. Never cell text.
 */
const writeAudit = async (m: EntityManager, userId: number, action: "create" | "update" | "delete", p: ImportMappingProfile, reason: string, extra: Record<string, { old: unknown; new: unknown }> = {}) => {
  const auditRepo = m.getRepository(AuditLog);
  const gone = action === "delete";
  await auditRepo.save(
    auditRepo.create({
      entity_type: "import_mapping_profile",
      entity_id: 0,
      action,
      changed_fields: {
        profile_id: { old: gone ? p.id : null, new: gone ? null : p.id },
        company_id: { old: gone ? Number(p.company_id) : null, new: gone ? null : Number(p.company_id) },
        site_id: { old: gone ? Number(p.site_id) : null, new: gone ? null : Number(p.site_id) },
        category_id: { old: gone ? p.category_id : null, new: gone ? null : p.category_id },
        fingerprint: { old: gone ? p.fingerprint : null, new: gone ? null : p.fingerprint },
        ...extra,
      },
      reason,
      changed_by: { user_id: userId } as any,
    }),
  );
};

let registered = false;

/** Subscribe the learner to onBatchCommitted once, at boot (src/index.ts). */
export const registerMappingMemoryListener = (onBatchCommitted: (l: (e: BatchCommittedEvent) => Promise<void>) => () => void): void => {
  if (registered) return;
  registered = true;
  onBatchCommitted(async (event) => {
    try {
      await learnFromBatch(event);
    } catch (err) {
      console.error(`Mapping memory: learning from batch ${event.upload_batch_id} failed:`, err instanceof Error ? err.message : err);
    }
  });
};
