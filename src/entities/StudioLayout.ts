import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-4 · a page layout (01-contracts §3 `report_layout`: RS + kind, format).
 * A FreeformPage with placeholder elements, the pages a template is made of
 * and what "Add page" offers. `slug` is `<family>/<role>` and is what
 * FreeformPage.layoutId holds; `page_kind` is the RS LayoutKind.
 */
@Entity("report_layout")
@Index("IDX_report_layout_slug_version", ["slug", "version"], { unique: true })
@Index("IDX_report_layout_family", ["family"])
export class StudioLayout {
  @PrimaryGeneratedColumn()
  id!: number;

  /** null = system. */
  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @Column({ type: "varchar", length: 180 })
  slug!: string;

  /** The template family (report_template.family). */
  @Column({ type: "varchar", length: 120 })
  family!: string;

  /** What the page is for (cover, exec_summary, scope1…); applyTemplate maps by it. */
  @Column({ type: "varchar", length: 60 })
  role!: string;

  /** RS LayoutKind. */
  @Column({ type: "varchar", length: 30 })
  page_kind!: string;

  /** ReportKind. */
  @Column({ type: "varchar", length: 20 })
  kind!: string;

  /** PageFormat. */
  @Column({ type: "varchar", length: 20 })
  format!: string;

  @Column({ type: "varchar", length: 200 })
  name!: string;

  /** FreeformPage with placeholders. */
  @Column({ type: "jsonb" })
  page!: Record<string, unknown>;

  @Column({ type: "varchar", length: 300, nullable: true })
  thumbnail_key!: string | null;

  @Column({ type: "int", default: 0 })
  sort!: number;

  @Column({ type: "int", default: 1 })
  version!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
