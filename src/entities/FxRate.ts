import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/**
 * One exchange rate per currency per day (S3-5, docs/scope3/01-contracts.md §4).
 * `rate_to_usd` is units of `currency` per 1 USD (INR ≈ 88), as the providers
 * publish it with base USD. Filled by the daily job (src/scope3/spend/fxJob.ts):
 * `ecb` (frankfurter.app, ECB reference rates), `open.er-api.com`, or `peg`
 * (AED, SAR, BHD). A spend row stores the rate it used in `emission.fx`.
 */
@Entity("fx_rate")
@Unique("UQ_fx_rate_currency_date", ["currency", "date"])
export class FxRate {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 3 })
  currency!: string;

  @Column({ type: "date" })
  date!: string;

  @Column({ type: "numeric", precision: 20, scale: 10 })
  rate_to_usd!: string;

  @Column({ type: "varchar", length: 100 })
  source!: string;

  @CreateDateColumn()
  created_at!: Date;
}
