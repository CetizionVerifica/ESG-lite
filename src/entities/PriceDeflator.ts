import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/**
 * A yearly price index per country (S3-5, docs/scope3/01-contracts.md §4).
 * Only ratios between years are used (index[factor base year] ÷ index[spend
 * year]), so a series may keep its own base: the seeded US CPI-U uses
 * 1982–84 = 100. Seeded by migrate:scope3-spend; Superadmins add series with
 * POST /scope3/deflators.
 */
@Entity("price_deflator")
@Unique("UQ_price_deflator_country_year", ["country", "year"])
export class PriceDeflator {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 16 })
  country!: string;

  @Column({ type: "int" })
  year!: number;

  @Column({ type: "numeric", precision: 12, scale: 4 })
  index!: string;

  @Column({ type: "varchar", length: 100 })
  source!: string;

  @CreateDateColumn()
  created_at!: Date;
}
