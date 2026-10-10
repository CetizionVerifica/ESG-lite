import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { PcfStudy } from "./PcfStudy";
import { User } from "./User";

// PCF (E1): the frozen numbers of a study, written on "Calculate". Together
// with factor_snapshot it regenerates byte-identical. Never reused as a CBAM
// "specific embedded emissions" figure.
@Entity()
export class PcfResult {
  @PrimaryGeneratedColumn()
  pcf_result_id!: number;

  @OneToOne(() => PcfStudy, { onDelete: "CASCADE" })
  @JoinColumn({ name: "pcf_study_id" })
  study!: PcfStudy;

  // Fossil total per declared unit (kg CO2e); biogenic, aircraft and LUC are reported separately.
  @Column({ type: "decimal" })
  total_kg_per_unit!: string;

  @Column("jsonb")
  by_stage!: Record<string, number>;

  @Column("jsonb")
  by_input!: Record<string, number>;

  @Column({ type: "decimal", default: 0 })
  biogenic_kg_per_unit!: string;

  @Column({ type: "decimal", default: 0 })
  aircraft_kg_per_unit!: string;

  @Column({ type: "decimal", default: 0 })
  luc_kg_per_unit!: string;

  @Column({ type: "decimal" })
  primary_data_share_pct!: string;

  @Column({ type: "decimal" })
  dqr_overall!: string;

  @Column("jsonb")
  cut_off!: Record<string, unknown>;

  // Every input, allocation and factor value the calculation read.
  @Column("jsonb")
  factor_snapshot!: Record<string, unknown>;

  @Column("int", { array: true, nullable: true })
  emission_ids_used!: number[] | null;

  @Column("int", { array: true, nullable: true })
  production_ids_used!: number[] | null;

  // true while the study is a draft: shown with a DRAFT mark, never exported as final.
  @Column({ default: true })
  is_draft!: boolean;

  @Column({ type: "varchar", length: 20 })
  engine_version!: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "calculated_by" })
  calculated_by!: User | null;

  @Column({ type: "timestamp" })
  calculated_at!: Date;
}
