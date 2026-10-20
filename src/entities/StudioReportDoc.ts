import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-5 · a Design Studio design (docs/design-studio/01-contracts.md §3
 * `report_doc`: the RS columns plus `kind`, `purpose`, `format`, `inputs`,
 * `source_doc_id`). `draft` is the whole ReportDoc v2 JSON; `rev` is its
 * optimistic lock (PATCH with a stale rev answers 409 DS_VERSION_CONFLICT).
 *
 * Studio code reads and writes this table with raw SQL in src/studio/docs
 * (and DS-2 src/studio/sources/inputs.ts for `inputs`); the entity exists so
 * the schema check and CI databases know it. migrate:ds-5-docs creates it.
 *
 * `build` holds the progress of the auto-build (new-design flow, polled with
 * GET /studio/docs/:id?build=1); `data_hash` the DS-2 data hash of the last
 * build or autosave.
 */
@Entity("report_doc")
@Index("IDX_report_doc_company_year", ["company_id", "year"])
export class StudioReportDoc {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  year!: number;

  @Column({ type: "varchar", length: 2 })
  year_type!: "CY" | "FY";

  @Column({ type: "varchar", length: 200 })
  title!: string;

  /** draft | in_review | approved | final (ReportStatus). */
  @Column({ type: "varchar", length: 20, default: "draft" })
  status!: string;

  @Column({ type: "jsonb" })
  draft!: Record<string, unknown>;

  @Column({ type: "int", default: 1 })
  rev!: number;

  /** ghg | sustainability (ReportKind). */
  @Column({ type: "varchar", length: 20 })
  kind!: string;

  /** report | summary | deck | social (DocPurpose). */
  @Column({ type: "varchar", length: 20, default: "report" })
  purpose!: string;

  /** PageFormat; one per doc (D18). */
  @Column({ type: "varchar", length: 20, default: "a4" })
  format!: string;

  /** Report inputs (01-contracts §2.1), `{key: {value, source, updatedBy, updatedAt}}`. */
  @Column({ type: "jsonb", default: () => "'{}'" })
  inputs!: Record<string, unknown>;

  /** The doc a resized copy was made from (DS-10). */
  @Column({ type: "int", nullable: true })
  source_doc_id!: number | null;

  /** The template the doc was built from (null for a blank design). */
  @Column({ type: "int", nullable: true })
  template_id!: number | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  data_hash!: string | null;

  /** Auto-build progress: {state, steps[], dropped[], startedAt, finishedAt, error?}. */
  @Column({ type: "jsonb", nullable: true })
  build!: Record<string, unknown> | null;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  deleted_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
