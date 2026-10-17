import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * SE-6 · A data-entry form saved to set up a category once and apply it to many
 * sites. `company_id` null is a global template (any client, and it seeds new
 * clients); a client's template is applied to that client's sites only.
 */
@Entity("form_template")
@Index("IDX_form_template_category", ["category_id"])
export class FormTemplate {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @Column({ type: "int" })
  category_id!: number;

  /** The category's name when the template was saved, for the list. */
  @Column({ type: "varchar", length: 255 })
  category_name!: string;

  /** The form as SE-4 stores a version (src/forms/versions.ts snapshotOf), plus `unit_names`: the site's unit list. */
  @Column({ type: "jsonb" })
  config!: Record<string, unknown>;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
