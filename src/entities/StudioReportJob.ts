import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-11 · a render job (01-contracts §3 `report_job`: the RS columns, + `png`
 * and `print` kinds, + `options`). One row per request: a proof, a print PDF,
 * PNG pages (zipped), a thumbnail or a final. The worker (src/studio/jobs/worker.ts)
 * renders the doc stored on the row at `rev`, stores the file privately
 * (src/studio/jobs/storage.ts) and, for a final, writes the version.
 *
 * `file_key` is never sent to a client: downloads go through
 * GET /studio/jobs/:id/file after the role and tenant checks. `doc` is the
 * draft the job was asked for; it is cleared once the job ends.
 */
@Entity("report_job")
@Index("IDX_report_job_status_created", ["status", "created_at"])
@Index("IDX_report_job_doc", ["doc_id", "created_at"])
export class StudioReportJob {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  doc_id!: number;

  /** The final version this job made (finals only). */
  @Column({ type: "int", nullable: true })
  version_id!: number | null;

  /** proof | final | thumbnail | png | print (JobKind). */
  @Column({ type: "varchar", length: 20 })
  kind!: string;

  /** queued | running | done | failed (JobStatus). */
  @Column({ type: "varchar", length: 20, default: "queued" })
  status!: string;

  /** The draft's rev the job renders. */
  @Column({ type: "int" })
  rev!: number;

  /** {cropMarks, bleed, pages: [from, to], dpi, pageId}. */
  @Column({ type: "jsonb", default: () => "'{}'" })
  options!: Record<string, unknown>;

  /** The ReportDoc to render (cleared when the job ends). */
  @Column({ type: "jsonb", nullable: true })
  doc!: Record<string, unknown> | null;

  /** A final's note (required when a final already exists, RS R10). */
  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ type: "jsonb", nullable: true })
  acknowledged_warnings!: string[] | null;

  /** timeout | font | chromium | measure | storage | data (DS_JOB_FAILED details.reason). */
  @Column({ type: "varchar", length: 40, nullable: true })
  error_code!: string | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "int", nullable: true })
  requested_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  started_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  finished_at!: Date | null;

  /** Private storage key of the output (R2 or local-private/); never in a response. */
  @Column({ type: "varchar", length: 300, nullable: true })
  file_key!: string | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  content_type!: string | null;

  @Column({ type: "int", nullable: true })
  bytes!: number | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  sha256!: string | null;

  @Column({ type: "int", nullable: true })
  page_count!: number | null;

  /** window.__measure() output, kept for DS-12 checks. */
  @Column({ type: "jsonb", nullable: true })
  measurements!: unknown[] | null;

  /** Proofs, prints, PNGs and thumbnails expire after 7 days; finals never. */
  @Column({ type: "timestamp", nullable: true })
  proof_expires_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
