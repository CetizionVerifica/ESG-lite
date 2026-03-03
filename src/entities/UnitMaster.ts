import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
} from "typeorm";

export enum UnitMasterStatus {
    ACTIVE = "Active",
    INACTIVE = "Inactive",
}

@Entity()
export class UnitMaster {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    name!: string;

    @Column()
    shortName!: string;

    @Column({
        type: "enum",
        enum: UnitMasterStatus,
        default: UnitMasterStatus.ACTIVE,
    })
    status!: UnitMasterStatus;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;

    @DeleteDateColumn()
    deleted_at!: Date | null;
}
