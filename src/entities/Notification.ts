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

export interface NotificationMeta {
  reviewer?: string;
  reason?: string | null;
  // UPLOAD_PENDING (IM4): the batch waiting for review
  upload_batch_id?: string;
  rows?: number;
  tco2e?: number;
  site_ids?: number[];
  months?: string[];
  channel?: string;
}

// Partial unique expression index ((meta->>'upload_batch_id'), user_id) WHERE
// type = 'UPLOAD_PENDING': one upload notification per user per batch (IM4).
// Created by migrate:upload-notification-index; TypeORM leaves it alone.
@Index("notification_upload_batch_user_uq", { synchronize: false })
@Entity()
export class Notification {
  @PrimaryGeneratedColumn({ type: "bigint" })
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

  // Structured details shown on the notification (P13): who reviewed and why.
  // Null on rows written before the column existed; clients fall back to the message.
  @Column({ type: "jsonb", nullable: true })
  meta!: NotificationMeta | null;

  @Index()
  @Column({ default: false })
  read!: boolean;

  @Index()
  @CreateDateColumn()
  created_at!: Date;
}
