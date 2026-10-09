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
