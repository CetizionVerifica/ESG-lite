import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * The KPI topics a user works on (KPI-3), like `user_categories` for emissions.
 * No rows = every topic of the user's sites. Set through the company user
 * update (`PATCH /company-admin/users/:id {kpi_topics}`).
 *
 * Wave D (D17): no longer read or written. migrate:kpi-topic-assignment turns
 * each grant into topic assignments once and stamps `converted_at`, so a
 * restart never refills a slot someone emptied. Kept, not dropped.
 */
@Entity("kpi_topic_grant")
@Index("UQ_kpi_topic_grant_user_topic", ["user_id", "topic"], { unique: true })
export class KpiTopicGrant {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "varchar", length: 30 })
  topic!: string;

  @CreateDateColumn()
  created_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  converted_at!: Date | null;
}
