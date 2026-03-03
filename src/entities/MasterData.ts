import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
} from "typeorm";

export enum MasterDataType {
    CATEGORY = "Category",
    SUBCATEGORY = "Subcategory",
    SUB_HEADING = "Sub-heading",
    DATA_HEADING = "Data Heading",
    KPI_FIELD = "KPI Field",
}

export enum MasterDataStatus {
    ACTIVE = "Active",
    INACTIVE = "Inactive",
}

export enum ResponseType {
    NUMERIC = "Numeric",
    TEXT = "Text",
}

@Entity()
export class MasterData {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ unique: true })
    code!: string;

    @Column()
    title!: string;

    @Column({ type: "text", nullable: true })
    description!: string;
    @Column({
        type: "enum",
        enum: MasterDataType,
        default: MasterDataType.CATEGORY,
    })
    type!: MasterDataType;

    @Column({ default: 1 })
    level!: number;

    @Column({ nullable: true })
    kpi_field_placeholder!: string;

    @Column({
        type: "enum",
        enum: MasterDataStatus,
        default: MasterDataStatus.ACTIVE,
    })
    status!: MasterDataStatus;

    @Column({
        type: "enum",
        enum: ResponseType,
        default: ResponseType.NUMERIC,
    })
    response_type!: ResponseType;

    @Column({ default: 0 })
    sequence!: number;

    @ManyToOne(() => MasterData, (master) => master.children, {
        nullable: true,
        onDelete: "SET NULL",
    })
    @JoinColumn({ name: "parent_id" })
    parent!: MasterData | null;

    @OneToMany(() => MasterData, (master) => master.parent)
    children!: MasterData[];

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;

    @DeleteDateColumn()
    deleted_at!: Date | null;
}
