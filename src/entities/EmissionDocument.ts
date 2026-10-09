import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Emission } from "./Emission";
import { User } from "./User";

export enum DocumentType {
  INVOICE = "invoice",
  RECEIPT = "receipt",
  REPORT = "report",
  CERTIFICATE = "certificate",
  OTHER = "other",
}

@Entity()
export class EmissionDocument {
  @PrimaryGeneratedColumn()
  document_id!: number;

  @Column()
  file_name!: string;

  @Column()
  original_name!: string;

  @Column()
  cloudinary_public_id!: string;

  @Column()
  cloudinary_url!: string;

  @Column({ nullable: true })
  secure_url!: string;

  @Column()
  file_type!: string;

  @Column({ nullable: true })
  file_size!: number;

  @Column({
    type: "enum",
    enum: DocumentType,
    default: DocumentType.OTHER,
  })
  document_type!: DocumentType;

  @Column({ nullable: true })
  description!: string;

  @ManyToOne(() => Emission, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "emission_id" })
  emission!: Emission;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "uploaded_by" })
  uploaded_by!: User;

  // Set when the file is a bill the AI service extracted (python_AI_service
  // `invoice.invoice_id`). The Cloudinary file then belongs to that invoice:
  // deleting this document must not delete it. No FK: the invoice table is
  // owned by the AI service.
  @Index()
  @Column({ type: "integer", nullable: true })
  ai_invoice_id!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
