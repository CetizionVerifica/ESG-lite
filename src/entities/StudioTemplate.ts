import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-4 · a whole-report template (docs/design-studio/01-contracts.md §3
 * `report_template`). System rows (company_id null) are seeded from
 * data/studio/templates/<kind>/<family>/ by `npm run migrate:ds-4-library`,
 * one row per look (`<family>-<look>`). The loader upserts by (slug, version):
 * a new version is a new row and the older one turns inactive, so docs made
 * from it keep their own copy unchanged. Company rows come from DS-13
 * ("Save as template").
 */
@Entity("report_template")
@Index("IDX_report_template_slug_version", ["slug", "version"], { unique: true })
@Index("IDX_report_template_company", ["company_id"])
export class StudioTemplate {
  @PrimaryGeneratedColumn()
  id!: number;

  /** null = a system template every company with the studio sees. */
  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @Column({ type: "varchar", length: 120 })
  slug!: string;

  /** The template the looks share; layouts belong to it. */
  @Column({ type: "varchar", length: 120 })
  family!: string;

  /** classic | light | night (D9); null for company templates. */
  @Column({ type: "varchar", length: 20, nullable: true })
  look!: string | null;

  /** ReportKind: ghg | sustainability. */
  @Column({ type: "varchar", length: 20 })
  kind!: string;

  /** DocPurpose: report | summary | deck | social. */
  @Column({ type: "varchar", length: 20 })
  purpose!: string;

  /** PageFormat. */
  @Column({ type: "varchar", length: 20 })
  format!: string;

  @Column({ type: "varchar", length: 200 })
  name!: string;

  @Column({ type: "text", default: "" })
  description!: string;

  @Column({ type: "text", array: true, default: () => "'{}'" })
  tags!: string[];

  /** ThemeOverrides the template starts from. */
  @Column({ type: "jsonb", default: () => "'{}'" })
  theme!: Record<string, unknown>;

  /** A full ReportDoc v2 with placeholders. */
  @Column({ type: "jsonb" })
  doc!: Record<string, unknown>;

  @Column({ type: "int", default: 0 })
  page_count!: number;

  /** R2 key of the cover thumbnail (DS-11 thumbnail jobs); null until rendered. */
  @Column({ type: "varchar", length: 300, nullable: true })
  thumbnail_key!: string | null;

  @Column({ type: "int", default: 1 })
  version!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
