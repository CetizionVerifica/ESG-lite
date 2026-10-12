import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";

/**
 * One row per MCP tool call (audit row MCP-15): who, which tool, which plan,
 * outcome and duration. Never the input or output payload, so sheet text and
 * client data don't end up in a log table. Created by `migrate:mcp-log`.
 */
@Entity({ name: "mcp_tool_call" })
export class McpToolCall {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("IDX_mcp_tool_call_grant_id")
  @Column({ type: "varchar", length: 64 })
  grant_id!: string;

  @Index("IDX_mcp_tool_call_user_id")
  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @Column({ type: "varchar", length: 64 })
  tool!: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  plan_id!: string | null;

  @Column({ type: "boolean" })
  ok!: boolean;

  @Column({ type: "varchar", length: 64, nullable: true })
  error_code!: string | null;

  @Column({ type: "int" })
  duration_ms!: number;

  @Index("IDX_mcp_tool_call_created_at")
  @Column({ type: "timestamp", default: () => "now()" })
  created_at!: Date;
}
