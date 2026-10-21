import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * PE-1 · an image job (docs/design-studio/pro/PE-1.md, contracts/pro.ts
 * `ImageJob`). One row per "Remove background" request on a company asset.
 * The worker (src/studio/images/jobs.ts) reads the source asset, runs the
 * background-remover engine (src/studio/images/bgRemove/) and stores the
 * result as a NEW report_asset row (`derived_from` = the source); the source
 * asset is never changed or deleted by it.
 */
@Entity("report_image_job")
@Index("IDX_report_image_job_company", ["company_id", "created_at"])
@Index("IDX_report_image_job_status", ["status", "created_at"])
export class StudioImageJob {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  /** remove_background (IMAGE_JOB_KINDS). */
  @Column({ type: "varchar", length: 30 })
  kind!: string;

  /** The source report_asset id (kept). */
  @Column({ type: "uuid" })
  asset_id!: string;

  /** queued | running | done | failed (JobStatus). */
  @Column({ type: "varchar", length: 20, default: "queued" })
  status!: string;

  /** The derived report_asset when done. */
  @Column({ type: "uuid", nullable: true })
  result_asset_id!: string | null;

  /** DS_JOB_FAILED (or DS_BG_UNAVAILABLE when the engine went away). */
  @Column({ type: "varchar", length: 40, nullable: true })
  error_code!: string | null;

  /** model | image | timeout | storage. */
  @Column({ type: "varchar", length: 40, nullable: true })
  error_reason!: string | null;

  /** Which engine ran ("onnx:<file>" or "stub"); never a path. */
  @Column({ type: "varchar", length: 80, nullable: true })
  engine!: string | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "int", nullable: true })
  requested_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  started_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  finished_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
