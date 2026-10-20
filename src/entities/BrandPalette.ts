import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-3 · a named colour palette in a company's brand kit
 * (docs/design-studio/01-contracts.md §3 `brand_palette`): up to 10 hex
 * colours, ordered by `sort`. Managers and Superadmins write them through
 * PUT /studio/brand-kit; everyone with studio access reads them. The first
 * palette (lowest `sort`) is the brand's primary palette for Styles.
 */
@Entity("brand_palette")
@Index("IDX_brand_palette_company", ["company_id"])
export class BrandPalette {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "varchar", length: 60 })
  name!: string;

  /** Lowercase "#rrggbb" strings, 1–10 of them. */
  @Column({ type: "jsonb" })
  colors!: string[];

  @Column({ type: "int", default: 0 })
  sort!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
