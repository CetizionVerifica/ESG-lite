import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-4 · an element template of the Elements drawer (01-contracts §3
 * `report_element`): shapes, lines, frames, grids, icons, SDG badges, ESG
 * graphics (editable groups) and data elements. System rows are seeded from
 * data/studio/elements/ and keyed by `slug`; every row names its licence
 * (data/studio/LICENSES.md).
 */
@Entity("report_element")
@Index("IDX_report_element_slug", ["slug"], { unique: true })
@Index("IDX_report_element_group", ["group"])
export class StudioElement {
  @PrimaryGeneratedColumn()
  id!: number;

  /** null = system. */
  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @Column({ type: "varchar", length: 120 })
  slug!: string;

  /** shapes | lines | frames | grids | icons | sdg | esg | data. */
  @Column({ type: "varchar", length: 20 })
  group!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "text", array: true, default: () => "'{}'" })
  tags!: string[];

  /** An Element template, or {type:'group', w, h, elements}. */
  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "varchar", length: 40 })
  license!: string;

  @Column({ type: "int", default: 0 })
  sort!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
