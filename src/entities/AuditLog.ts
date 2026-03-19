import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from "typeorm";
import { User } from "./User";

@Entity()
export class AuditLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  entity_type!: "emission" | "production_data";

  @Column()
  entity_id!: number;

  @Column()
  action!: string;

  @Column("jsonb")
  changed_fields!: Record<string, { old: any; new: any }>;

  @ManyToOne(() => User)
  @JoinColumn({ name: "changed_by" })
  changed_by!: User;

  @CreateDateColumn()
  changed_at!: Date;
}
