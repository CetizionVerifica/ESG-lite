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

  @OneToMany(() => Site, site => site.company)
  sites!: Site[];
}