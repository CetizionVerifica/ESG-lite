import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A closed month (S3-15 part 2, docs/scope3/01-contracts.md §4, D11): per
 * company, site and month. A company-wide lock is a shortcut that writes one
 * row per site, so each site can be reopened on its own; `site_id` null (every
 * site) and `month` null (the whole year) are allowed by the contract and
 * honoured by the guard, but nothing writes them today.
 *
 * Active while `reopened_at` is null. Reopening keeps the row (who, when and
 * why); locking again clears the reopen fields. Every lock and reopen also
 * writes an `audit_log` row (`scope3_period_lock`).
 *
 * The unique index treats a null site and month as one value, so it is an
 * expression index made by migrate:scope3-review-workflow (TypeORM can't
 * declare it; `synchronize: false` keeps the schema check away from it).
 */
@Entity("period_lock")
@Index("UQ_period_lock_company_site_year_month", { synchronize: false })
@Index("IDX_period_lock_company_year_month", ["company_id", "year", "month"])
export class PeriodLock {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int", nullable: true })
  site_id!: number | null;

  @Column({ type: "int" })
  year!: number;

  @Column({ type: "int", nullable: true })
  month!: number | null;

  @Column({ type: "int" })
  locked_by!: number;

  @Column({ type: "timestamp", default: () => "now()" })
  locked_at!: Date;

  @Column({ type: "int", nullable: true })
  reopened_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  reopened_at!: Date | null;

  @Column({ type: "text", nullable: true })
  reopened_reason!: string | null;
}
