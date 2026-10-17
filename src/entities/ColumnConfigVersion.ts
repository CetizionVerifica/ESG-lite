import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * SE-4 · A published version of a data-entry form: the whole config as it
 * went live, who published it, when and why. `column_config.version` is the
 * latest; entries record the version they were saved with (`emission.form_version`).
 */
@Entity("column_config_version")
@Index("UQ_column_config_version_config_version", ["column_config_id", "version"], { unique: true })
export class ColumnConfigVersion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  column_config_id!: number;

  @Column({ type: "int" })
  version!: number;

  /** The form as published (columns by id, choices, mapping, calculation and the SE-2 settings). */
  @Column({ type: "jsonb" })
  config!: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ type: "int", nullable: true })
  published_by!: number | null;

  @Column({ type: "timestamp", default: () => "now()" })
  published_at!: Date;
}
