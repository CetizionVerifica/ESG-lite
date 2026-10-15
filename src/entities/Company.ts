import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from "typeorm";
import { Site } from "./Site";

@Entity()
export class Company {
  @PrimaryGeneratedColumn()
  company_id!: number;

  @Column()
  name!: string;

  @Column()
  address!: string;

  @Column()
  contact_person!: string;

  @Column({ nullable: true })
  email!: string;

  @Column({ nullable: true })
  phone_number!: string;

  @Column({ nullable: true })
  industry!: string;

  @Column({ nullable: true })
  region!: string;

  @Column({ nullable: true })
  employee_range!: string;

  @Column({ nullable: true })
  cin_number!: string;

  @Column({ default: true })
  status!: boolean;

  @Column({ nullable: true })
  subscription_id!: string;

  @Column({ name: "is_email_verified", default: false })
  isEmailVerified!: boolean;

  @Column({ name: "esg_mitra_access", default: false })
  esgMitraAccess!: boolean;

  // "Allow Claude imports" (MCP import plan, IM5). Off by default: with it
  // off every MCP tool for this client answers MCP_DISABLED_FOR_CLIENT.
  // Superadmin toggles it through PUT /admin/companies/:id.
  @Column({ default: false })
  mcp_enabled!: boolean;

  // "Smart import" for Managers and Admins (smart Excel import, XI0). Off by
  // default: with it off POST /v1/excel/propose and the in-app smart flow
  // answer AI_IMPORT_DISABLED_FOR_CLIENT. Superadmin toggles it through
  // PUT /admin/companies/:id. Separate from mcp_enabled (Claude/MCP stays
  // Superadmin only).
  @Column({ default: false })
  ai_import_enabled!: boolean;

  // When the client was onboarded (redesign P16 Console activity); NULL for
  // clients that predate migrate:company-created-at. Set by
  // stampCompanyOnboarded after a company is created. No default here and
  // select/insert/update false, so every company read and save works on a
  // database where the migration has not run yet.
  @Column({ type: "timestamp", nullable: true, select: false, insert: false, update: false })
  created_at?: Date | null;

  @OneToMany(() => Site, site => site.company)
  sites!: Site[];
}