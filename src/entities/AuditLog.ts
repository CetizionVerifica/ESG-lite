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
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: number;

  @Column()
  // S3-0: Scope 3 modules write their own `scope3_*` entity types (boundary, base year, locks, supplier factors).
  // KPI-0: KPI modules write `kpi_value`, `kpi_setup`, `kpi_period_lock`, `kpi_target`, `kpi_library` (src/kpi/contracts/enums.ts).
  entity_type!: "emission" | "production_data" | "pcf_study" | "category_mapping" | "import_mapping_profile" | `scope3_${string}` | `kpi_${string}`;

  // Holds emission ids among others, so bigint like emission.pk_id (#191).
  @Column({ type: "bigint" })
  entity_id!: number;

  @Column()
  action!: string;

  @Column("jsonb")
  changed_fields!: Record<string, { old: any; new: any }>;

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: "changed_by" })
  changed_by!: User;

  @CreateDateColumn()
  changed_at!: Date;
}
