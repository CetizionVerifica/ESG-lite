import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * D17 (wave D): who enters a KPI topic on a site, or at company level
 * (`site_id` null), and who reviews it (`reviewer_user_id` null = the site's
 * Managers). A per-KPI `kpi_assignment` row overrides it; `setup/owners.ts`
 * resolves the two. One row per (company, site, topic): the unique index
 * treats a null site as one value, so it is an expression index made by
 * migrate:kpi-topic-assignment (`synchronize: false`).
 */
@Entity("kpi_topic_assignment")
@Index("UQ_kpi_topic_assignment_company_site_topic", { synchronize: false })
@Index("IDX_kpi_topic_assignment_company_owner", ["company_id", "owner_user_id"])
export class KpiTopicAssignment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int", nullable: true })
  site_id!: number | null;

  @Column({ type: "varchar", length: 30 })
  topic!: string;

  @Column({ type: "int" })
  owner_user_id!: number;

  @Column({ type: "int", nullable: true })
  reviewer_user_id!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;
}
