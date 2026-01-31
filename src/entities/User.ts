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
import { UserRole } from "../types/type";

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

  @Column()
  password!: string;

  @Column({ nullable: true })
  password_reset_token?: string;

  @Column({ type: "timestamp", nullable: true })
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
}
