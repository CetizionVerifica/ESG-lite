import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-4 · an uploaded image (01-contracts §3 `report_asset`: RS + folder).
 * Stored in R2 (or local-uploads/ without R2) after re-encoding (jpg, png,
 * webp; EXIF stripped) or sanitising (svg). Same bytes in the same company
 * return the existing row (sha256). Docs reference it by `id`.
 */
@Entity("report_asset")
@Index("IDX_report_asset_company", ["company_id"])
@Index("IDX_report_asset_company_sha", ["company_id", "sha256"])
export class StudioAsset {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "int" })
  company_id!: number;

  /** image | logo | ai_image. */
  @Column({ type: "varchar", length: 20, default: "image" })
  kind!: string;

  /** R2 key, or a path under the local asset folder. */
  @Column({ type: "varchar", length: 300 })
  r2_key!: string;

  @Column({ type: "varchar", length: 40 })
  mime!: string;

  @Column({ type: "int" })
  bytes!: number;

  @Column({ type: "int" })
  w!: number;

  @Column({ type: "int" })
  h!: number;

  @Column({ type: "varchar", length: 500, default: "" })
  alt!: string;

  @Column({ type: "varchar", length: 64 })
  sha256!: string;

  /** DS-4: a folder name in the Uploads drawer; null = none. */
  @Column({ type: "varchar", length: 60, nullable: true })
  folder!: string | null;

  /** PE-1: the source asset when this one was derived from it (background removed); null = an upload. */
  @Column({ type: "uuid", nullable: true })
  derived_from!: string | null;

  /** PE-1: how it was derived (remove_background). */
  @Column({ type: "varchar", length: 30, nullable: true })
  derived_op!: string | null;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
