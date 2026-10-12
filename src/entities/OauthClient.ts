import { Entity, PrimaryColumn, Column, CreateDateColumn } from "typeorm";

/**
 * An OAuth client registered through dynamic client registration
 * (POST /oauth/register), e.g. claude.ai's connector or MCP Inspector.
 * Public clients only (token_endpoint_auth_method "none"); PKCE guards the
 * code exchange. See src/oauth/CLAUDE.md.
 */
@Entity({ name: "oauth_client" })
export class OauthClient {
  @PrimaryColumn({ type: "varchar", length: 64 })
  client_id!: string;

  @Column({ type: "varchar", length: 200 })
  client_name!: string;

  @Column({ type: "jsonb" })
  redirect_uris!: string[];

  @Column({ type: "varchar", length: 40, default: "none" })
  token_endpoint_auth_method!: string;

  // No database default: Postgres rewrites a jsonb default and TypeORM's
  // schema diff then never matches. registerClient sets it.
  @Column({ type: "jsonb" })
  grant_types!: string[];

  @Column({ type: "varchar", length: 500, nullable: true })
  client_uri!: string | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  logo_uri!: string | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
