import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
} from "typeorm";
import { Site } from "./Site";
import { MasterData } from "./MasterData";
import { User } from "./User";

export enum EntryStatus {
    DRAFT = "Draft",
    READY_FOR_REVIEW = "Ready for Review",
    SUBMITTED = "Submitted",
    VERIFIED = "Verified",
    REJECTED = "Rejected",
}

@Entity()
export class AllDataEntry {
    @PrimaryGeneratedColumn()
    id!: number;

    @ManyToOne(() => Site, { onDelete: "CASCADE" })
    @JoinColumn({ name: "site_id" })
    site!: Site;

    @ManyToOne(() => MasterData, { onDelete: "CASCADE" })
    @JoinColumn({ name: "master_data_id" })
    masterData!: MasterData;

    @Column("decimal", { precision: 15, scale: 4, nullable: true })
    value!: number | null;

    @Column({ type: "text", nullable: true })
    text_value!: string | null;

    @Column()
    unit!: string;

    @Column({ type: "date" })
    reporting_date!: Date;

    @Column({
        type: "enum",
        enum: EntryStatus,
        default: EntryStatus.DRAFT,
    })
    status!: EntryStatus;

    @Column({ type: "text", nullable: true })
    notes!: string;

    @Column({ nullable: true })
    evidence_path!: string;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: "created_by" })
    created_by!: User;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: "reviewed_by" })
    reviewed_by!: User | null;

    @Column({ type: "text", nullable: true })
    review_comment!: string;

    @Column({ type: "timestamp", nullable: true })
    reviewed_at!: Date | null;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
