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

  // Scope 3 boundary approach (S3-1, D4): operational_control (default),
  // financial_control or equity_share. Read by reports (S3-13).
  @Column({ type: "varchar", length: 30, default: "operational_control" })
  consolidation_approach!: string;

  // Review workflow v2 (S3-15 part 2, D9): drafts, submit and the month lock.
  // Off by default; Superadmin turns it on per client through PUT
  // /admin/companies/:id. Off means today's behaviour exactly.
  @Column({ default: false })
  review_workflow_v2!: boolean;

  // Simple data entry SE-2 (migrate:entry-forms). The currency a spend row
  // takes when neither the row nor its form says (INR for current clients),
  // and how much of the calculation a User sees: "total" (default) or "full".
  @Column({ type: "varchar", length: 3, default: "INR" })
  default_currency!: string;

  @Column({ type: "varchar", length: 8, default: "total" })
  entry_detail!: string;

  // KPI-1: KPI tracking (GRI, BRSR, ESRS) for this client, docs/kpi/. Off by
  // default: with it off every /kpi route except /kpi/status and the
  // Superadmin library answers KPI_TRACKING_OFF. Superadmin toggles it through
  // PUT /admin/companies/:id (migrate:kpi-switch).
  @Column({ default: false })
  kpi_tracking_enabled!: boolean;

  @OneToMany(() => Site, site => site.company)
  sites!: Site[];
}