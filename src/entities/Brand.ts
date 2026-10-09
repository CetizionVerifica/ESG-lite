import { Entity, PrimaryColumn, Column, UpdateDateColumn } from "typeorm";

// The app-wide looks a client can pick as its default (redesign F1/P18).
export const BRAND_LOOKS = ["classic", "light", "night"] as const;
export type BrandLook = (typeof BRAND_LOOKS)[number];

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

  // White/mono logo for dark surfaces (Classic top bar, Night look). Same R2
  // flow as logo_url, under its own key.
  @Column({ name: "logo_on_dark_url", type: "varchar", nullable: true })
  logoOnDarkUrl!: string | null;

  @Column({ name: "logo_on_dark_public_id", type: "varchar", nullable: true })
  logoOnDarkPublicId!: string | null;

  @Column({ name: "default_look", type: "varchar", length: 10, default: "classic" })
  defaultLook!: BrandLook;

  // Optional override for the Scope 3 chart colour; null = derived by the FE.
  @Column({ name: "scope3_colour", type: "varchar", nullable: true })
  scope3Colour!: string | null;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
