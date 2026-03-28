import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from "typeorm";
import { User } from "./User";

@Entity()
export class Notification {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  // Matches email types: APPROVED, REJECTED, BULK_APPROVED, etc.
  @Column()
  type!: string;

  @Column()
  title!: string;

  @Column({ type: "text" })
  message!: string;

  // Deep link path, e.g. "/data-entry?site=3&category=5"
  @Column({ type: "varchar", nullable: true })
  link!: string | null;

  @Index()
  @Column({ default: false })
  read!: boolean;

  @Index()
  @CreateDateColumn()
  created_at!: Date;
}
