import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from "typeorm";
import { Company } from "./Company";


@Entity()
@Unique(["company"])
export class EmissionThreshold {
  @PrimaryGeneratedColumn()
  threshold_id!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ type: "decimal", precision: 5, scale: 2, default: 5.0 })
  threshold_percentage!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}