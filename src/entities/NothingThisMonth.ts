import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * "Nothing this month" (S3-15 part 2, docs/scope3/01-contracts.md §4 and §10):
 * a contributor says a site has no data for a category in a month, so the
 * month can be closed without an entry. `period` is the first day of the
 * month, like `emission.date_of_reporting` of a monthly row.
 */
@Entity("nothing_this_month")
@Index("UQ_nothing_this_month_site_category_period", ["site_id", "category_id", "period"], { unique: true })
export class NothingThisMonth {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "int" })
  category_id!: number;

  @Column({ type: "date" })
  period!: string;

  @Column({ type: "int" })
  user_id!: number;

  @CreateDateColumn()
  created_at!: Date;
}
