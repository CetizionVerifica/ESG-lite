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

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

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
