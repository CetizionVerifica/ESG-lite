import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
} from "typeorm";
import { Site } from "./Site";
import { Category } from "./Category";
import type { FactorType, GwpSet } from "../scope3/contracts/factor";

@Entity("emission_factors")
@Unique(["site", "category", "year", "emission_category_name"])
export class EmissionFactor {
  @PrimaryGeneratedColumn()
  emission_factor_id!: number;

  @ManyToOne(() => Site, site => site.emission_factors, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @ManyToOne(() => Category, category => category.emission_factors, { onDelete: "CASCADE" })
  @JoinColumn({ name: "category_id" })
  category!: Category;

  @Column()
  year!: number;

  // numeric(18,8) since S3-2 (was 10,4); TypeORM reads it back as a string.
  @Column("decimal", { precision: 18, scale: 8 })
  factor_value!: number;

  @Column({ nullable: true })
  denominator_unit!: string;

  @Column({ nullable: true })
  source!: string;

  @Column({ nullable: true })
  emission_category_name!: string;

  @Column({ nullable: true })
  global_category_name!: string;

  @CreateDateColumn()
  created_at!: Date;

  @Column({ nullable: true })
  upload_batch_id!: string;

  // S3-2 · factor metadata (docs/scope3/01-contracts.md §2, migrate:scope3-factor-meta).
  // All nullable: a factor saved before Scope 3 keeps working. Values come
  // from src/scope3/contracts/factor.ts.
  @Column({ type: "varchar", length: 20, nullable: true })
  factor_type!: FactorType | null;

  @Column({ type: "varchar", length: 8, nullable: true })
  gwp_set!: GwpSet | null;

  /** ISO-3166 alpha-2, `GLO`, or a region code. */
  @Column({ type: "varchar", length: 16, nullable: true })
  geography!: string | null;

  @Column({ type: "varchar", length: 60, nullable: true })
  dataset!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  dataset_version!: string | null;

  // Gas parts, kg per denominator unit (other_kgco2e in kgCO₂e).
  @Column("decimal", { precision: 18, scale: 8, nullable: true })
  co2_kg!: string | null;

  @Column("decimal", { precision: 18, scale: 8, nullable: true })
  ch4_kg!: string | null;

  @Column("decimal", { precision: 18, scale: 8, nullable: true })
  n2o_kg!: string | null;

  @Column("decimal", { precision: 18, scale: 8, nullable: true })
  other_kgco2e!: string | null;

  @Column("decimal", { precision: 18, scale: 8, nullable: true })
  biogenic_co2_kg!: string | null;

  /** A life-cycle factor that already sums in WTT (S3-7 flags it, D6). */
  @Column({ type: "boolean", default: false })
  includes_wtt!: boolean;

  // eeio_spend only (S3-5 uses them).
  @Column({ type: "int", nullable: true })
  price_base_year!: number | null;

  @Column({ type: "varchar", length: 3, nullable: true })
  price_currency!: string | null;
}
