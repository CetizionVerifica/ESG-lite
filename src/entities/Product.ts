import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Site } from "./Site";
import { ProductionData } from "./ProductionData";

@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  product_id!: number;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  @Column()
  unit!: string; // Default unit of measurement for production (e.g., "tonnes", "units", "kWh")

  @ManyToOne(() => Site, (site) => site.products, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  // PCF (E1): what one footprint is expressed per, e.g. 1 kg or 1 km.
  @Column({ type: "varchar", length: 20, nullable: true })
  declared_unit!: string | null;

  @Column({ type: "decimal", nullable: true })
  declared_unit_qty!: string | null;

  @Column({ type: "decimal", nullable: true })
  mass_per_unit_kg!: string | null;

  @Column({ type: "varchar", nullable: true })
  pcr_tag!: string | null;

  // S3-10: Scope 3 sold products (docs/scope3/01-contracts.md §4, §10). Product gains
  // columns although the plan lists it as read-only (allowed deviation, §10).
  /** Lifetime uses of one product (Category 11), or of the customer's final product (11.5). */
  @Column({ type: "decimal", nullable: true })
  lifetime_uses!: string | null;

  /** End-of-life mix `[{treatment, share}]`, shares summing to 1 (Category 12). */
  @Column({ type: "jsonb", nullable: true })
  eol_mix!: Array<{ treatment: string; share: number }> | null;

  /**
   * STAND-IN until an S3-0 follow-up names it: the rest of the use profile the
   * Category 11 and 12 plans need (packaging per unit, how the product is used).
   * Shape: src/scope3/soldProducts/schemas.ts UseProfileExtraSchema.
   */
  @Column({ type: "jsonb", nullable: true })
  use_profile!: Record<string, string | number | null> | null;

  @OneToMany(() => ProductionData, (pd) => pd.product)
  production_data!: ProductionData[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
