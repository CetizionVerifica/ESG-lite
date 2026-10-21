import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";

/**
 * PE-2 · an uploaded brand font family (docs/design-studio/pro/PE-2.md, decision E3).
 * Managers and Superadmins upload it through POST /studio/brand-kit/fonts after
 * ticking "we hold a licence that allows embedding this font in PDFs"; who
 * ticked it and when is stored here. Docs reference it as `custom:<id>`.
 */
@Entity("brand_font")
@Index("IDX_brand_font_company", ["company_id"])
@Index("UQ_brand_font_company_family", ["company_id", "family_key"], { unique: true })
export class BrandFont {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  /** As the Manager typed it (≤ 60, no quotes or CSS punctuation). */
  @Column({ type: "varchar", length: 60 })
  family!: string;

  /** lower(trim(family)): one family per name per company. */
  @Column({ type: "varchar", length: 60 })
  family_key!: string;

  @Column({ type: "int", nullable: true })
  licence_confirmed_by!: number | null;

  @Column({ type: "timestamp" })
  licence_confirmed_at!: Date;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;
}

/**
 * PE-2 · one weight/style file of a brand font. The bytes live in the row
 * (≤ 5 MB, magic bytes checked), never in the public asset bucket: they are
 * served only behind the studio guard and inlined into server renders.
 */
@Entity("brand_font_file")
@Index("IDX_brand_font_file_font", ["font_id"])
@Index("UQ_brand_font_file_face", ["font_id", "weight", "style"], { unique: true })
export class BrandFontFile {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ type: "int" })
  font_id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  weight!: number;

  @Column({ type: "varchar", length: 10 })
  style!: string;

  @Column({ type: "varchar", length: 10 })
  format!: string;

  @Column({ type: "int" })
  bytes!: number;

  @Column({ type: "varchar", length: 64 })
  sha256!: string;

  @Column({ type: "bytea" })
  data!: Buffer;

  @Column({ type: "int", nullable: true })
  licence_confirmed_by!: number | null;

  @Column({ type: "timestamp" })
  licence_confirmed_at!: Date;

  @CreateDateColumn()
  created_at!: Date;
}
