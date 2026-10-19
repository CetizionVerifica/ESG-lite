import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
} from "typeorm";
import { Site } from "./Site";
import { Company } from "./Company";
import { Category } from "./Category";
import { UserRole } from "../types/type";

// Per-user colour scheme for the app (redesign F1/P14). "system" follows the OS.
export const USER_APPEARANCES = ["light", "dark", "system"] as const;
export type UserAppearance = (typeof USER_APPEARANCES)[number];

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  user_id!: number;

  @Column({ nullable: true })
  name!: string;

  @Column({ nullable: true })
  last_name!: string;

  @Column({ nullable: true })
  phone_number!: string;

  @Column({ unique: true })
  email!: string;

  // Never loaded unless asked for (addSelect), so a user joined into any
  // response cannot leak the hash or a reset token. Login selects it.
  @Column({ select: false })
  password!: string;

  @Column({ nullable: true, select: false })
  password_reset_token?: string;

  @Column({ type: "timestamp", nullable: true, select: false })
  password_reset_expires?: Date;

  @Column()
  role!: UserRole;

  // An Admin belongs to a company, not a site: `company_id` is set for Admins only (site_id null,
  // no user_sites). Managers and Users have no company_id; their company comes from their sites.
  // resolveUserCompanyId reads this first. Added by migrate:user-company.
  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @ManyToOne(() => Company, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company | null;

  // For regular users (one site)
  @ManyToOne(() => Site, (site) => site.users, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  // For managers (multiple sites)
  @ManyToMany(() => Site, (site) => site.managers)
  @JoinTable({
    name: "user_sites",
    joinColumn: {
      name: "user_id",
      referencedColumnName: "user_id",
    },
    inverseJoinColumn: {
      name: "site_id",
      referencedColumnName: "site_id",
    },
  })
  sites!: Site[];

  // Notification preferences (which email types to receive)
  @Column({ type: "jsonb", nullable: true, default: () => "'{}'" })
  notification_preferences!: Record<string, boolean>;

  // User timezone (IANA format, e.g. "Asia/Dubai")
  @Column({ type: "varchar", nullable: true })
  timezone!: string | null;

  @Column({ type: "varchar", length: 10, default: "system" })
  appearance!: UserAppearance;

  // An internal (PlanetPulse/Cetizion team) account. Only internal accounts may
  // hold sites of several clients; a client's people stay within one client.
  // Set by a Superadmin on the Users page.
  @Column({ type: "boolean", default: false })
  is_internal!: boolean;

  // Set on every successful login; shown as "Last active" on the Users page
  // (redesign P20). select: false so ordinary user reads (login included)
  // keep working on a database where migrate:user-last-login has not run yet;
  // insert: false keeps it out of every INSERT, so creating users also works
  // before the migration; only login (an UPDATE) writes it.
  @Column({ type: "timestamp", nullable: true, select: false, insert: false })
  last_login_at?: Date | null;

  // One-time sign-in code sent by email ("Sign in with a code" on the login
  // page, for people who forgot their password). Only an HMAC of the code is
  // stored; it expires after a few minutes and is cleared on use or after too
  // many wrong tries. select/insert false like last_login_at, so the app keeps
  // working before migrate:user-login-otp runs. See loginOtp.controller.ts.
  @Column({ type: "varchar", length: 64, nullable: true, select: false, insert: false })
  login_otp_hash?: string | null;

  @Column({ type: "timestamp", nullable: true, select: false, insert: false })
  login_otp_expires?: Date | null;

  @Column({ type: "int", nullable: true, select: false, insert: false })
  login_otp_attempts?: number | null;

  // Per-user category access control (managed by Manager role)
  @ManyToMany(() => Category)
  @JoinTable({
    name: "user_categories",
    joinColumn: {
      name: "user_id",
      referencedColumnName: "user_id",
    },
    inverseJoinColumn: {
      name: "category_id",
      referencedColumnName: "category_id",
    },
  })
  categories!: Category[];
}
