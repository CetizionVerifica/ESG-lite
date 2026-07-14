import { Entity, PrimaryColumn, Column, UpdateDateColumn } from "typeorm";

// Per-client branding for generated reports. One row per company.
// Colors drive the report theme; the logo lives in Cloudinary (logo_url +
// logo_public_id) so binaries stay out of the DB and git. Replaces the local
// brand-assets/<companyId>/ folder used in development.
@Entity({ name: "brand" })
export class Brand {
  @PrimaryColumn({ name: "company_id" })
  companyId!: number;

  @Column()
  name!: string;

  @Column({ default: "#1f2a44" })
  primary!: string;

  @Column({ default: "#3b82f6" })
  accent!: string;

  @Column({ name: "cover_from", default: "#0d1526" })
  coverFrom!: string;

  @Column({ name: "cover_to", default: "#1f2a44" })
  coverTo!: string;

  @Column({ name: "logo_url", type: "varchar", nullable: true })
  logoUrl!: string | null;

  @Column({ name: "logo_public_id", type: "varchar", nullable: true })
  logoPublicId!: string | null;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
