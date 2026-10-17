import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A closed KPI period (KPI-4 table, KPI-8 endpoints; docs/kpi/01-contracts.md §2),
 * separate from the emissions `period_lock` and the same shape. `year` is the
 * reporting year in `year_type` (FY 2026 = April 2025 to March 2026); `period`
 * is a calendar month 1–12, or null for the whole year; `site_id` null covers
 * every site. A value is locked when an active lock's range overlaps its period.
 * Active while `reopened_at` is null.
 *
 * The unique index treats a null site and period as one value, so it is an
 * expression index made by migrate:kpi-values (`synchronize: false`).
 */
@Entity("kpi_period_lock")
@Index("UQ_kpi_period_lock_company_site_year_period", { synchronize: false })
@Index("IDX_kpi_period_lock_company_year", ["company_id", "year"])
export class KpiPeriodLock {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int", nullable: true })
  site_id!: number | null;

  @Column({ type: "int" })
  year!: number;

  @Column({ type: "int", nullable: true })
  period!: number | null;

  /** CY | FY: how `year` reads */
  @Column({ type: "varchar", length: 2, default: "CY" })
  year_type!: string;

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
