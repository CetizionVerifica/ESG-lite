import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";
import { OauthClient } from "./OauthClient";

/**
 * One user's consent for one client ("ESGLite connected to Claude").
 * Tokens hang off a grant; disconnecting sets revoked_at (history is kept,
 * nothing is deleted). See src/oauth/CLAUDE.md.
 */
@Entity({ name: "oauth_grant" })
export class OauthGrant {
  @PrimaryGeneratedColumn()
  grant_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "integer" })
  user_id!: number;

  @ManyToOne(() => OauthClient, { onDelete: "CASCADE" })
  @JoinColumn({ name: "client_id" })
  client!: OauthClient;

  @Column({ type: "varchar", length: 64 })
  client_id!: string;

  /** Space-separated scopes, e.g. "imports:read imports:write". */
  @Column({ type: "varchar", length: 200 })
  scopes!: string;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  last_used_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  revoked_at!: Date | null;
}
