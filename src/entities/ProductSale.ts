import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * What a company sold of one product in one month (S3-10, Categories 10, 11
 * and 12; docs/scope3/01-contracts.md §4 with the §10 monthly `period`).
 * Activity data only: the Category 10/11/12 rows are made from it by
 * POST /scope3/sold-products/plan and calculated by emissionWrite.
 */
@Entity("product_sale")
@Index("IDX_product_sale_company_period", ["company_id", "period"])
@Index("IDX_product_sale_product", ["product_id"])
export class ProductSale {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  product_id!: number;

  /** First day of the month, like `emission.date` (§10). */
  @Column({ type: "date" })
  period!: string;

  @Column("decimal", { precision: 18, scale: 4 })
  quantity!: string;

  /** As sold: the product's own unit (pieces, drums, km of cable) or a mass unit (kg, t). */
  @Column({ type: "varchar", length: 50 })
  unit!: string;

  /** Where it was sold (a country or market); free text. */
  @Column({ type: "varchar", length: 100, nullable: true })
  region!: string | null;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
