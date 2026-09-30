import type { Pool } from "pg";

import type { CmdAction, IssuerRole } from "../../../contract/contract.js";
import type {
  ApplyAckResult,
  CommandLogEntry,
  CommandRecord,
  CommandRepository,
  CommandStatus,
  CommandToIssue,
} from "../../../domain/ports/CommandRepository.js";

interface CommandRow {
  id: string;
  cmd_id: string;
  node_code: string;
  email: string;
  issued_by_role: IssuerRole;
  action: CmdAction;
  params: Record<string, unknown>;
  status: CommandStatus;
  reason: string | null;
  issued_at: Date;
  sent_at: Date;
  delivered_at: Date | null;
  executed_at: Date | null;
  rejected_at: Date | null;
}

const COMMAND_SELECT = `
  SELECT c.id, c.cmd_id, n.node_code, u.email, c.issued_by_role, c.action,
         c.params, c.status, c.reason, c.issued_at, c.sent_at,
         c.delivered_at, c.executed_at, c.rejected_at
    FROM commands c
    JOIN nodes n ON n.id = c.target_node_id
    JOIN users u ON u.id = c.issued_by_user_id`;

function toRecord(r: CommandRow): CommandRecord {
  return {
    id: r.id,
    cmdId: r.cmd_id,
    targetNodeCode: r.node_code,
    issuedByEmail: r.email,
    issuedByRole: r.issued_by_role,
    action: r.action,
    params: r.params,
    status: r.status,
    reason: r.reason,
    issuedAt: r.issued_at,
    sentAt: r.sent_at,
    deliveredAt: r.delivered_at,
    executedAt: r.executed_at,
    rejectedAt: r.rejected_at,
  };
}

/** Columna de marca de tiempo que corresponde a cada estado. */
const TIMESTAMP_COLUMN = {
  delivered: "delivered_at",
  executed: "executed_at",
  rejected: "rejected_at",
} as const;

export class PgCommandRepository implements CommandRepository {
  constructor(private readonly pool: Pool) {}

  async issue(cmd: CommandToIssue): Promise<CommandRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: nodeRows } = await client.query<{ id: string }>(
        `SELECT id FROM nodes WHERE node_code = $1`,
        [cmd.targetNodeCode]
      );
      const node = nodeRows[0];
      if (!node) {
        await client.query("ROLLBACK");
        return null;
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO commands (cmd_id, target_node_id, issued_by_user_id,
                               issued_by_role, action, params, status, issued_at)
         VALUES ($1,$2,$3,$4,$5,$6,'sent',$7)
         RETURNING id`,
        [
          cmd.cmdId,
          node.id,
          cmd.issuedByUserId,
          cmd.issuedByRole,
          cmd.action,
          JSON.stringify(cmd.params),
          cmd.issuedAt,
        ]
      );
      const commandId = rows[0]!.id;

      // La primera línea de la bitácora la escribe el backend, no llega
      // por MQTT: por eso msg_id va NULL.
      await client.query(
        `INSERT INTO command_log (command_id, msg_id, status) VALUES ($1, NULL, 'sent')`,
        [commandId]
      );

      const { rows: full } = await client.query<CommandRow>(
        `${COMMAND_SELECT} WHERE c.id = $1`,
        [commandId]
      );

      await client.query("COMMIT");
      return toRecord(full[0]!);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async applyAck(input: {
    cmdId: string;
    msgId: string;
    status: Exclude<CommandStatus, "sent">;
    reason?: string;
    occurredAt: Date;
  }): Promise<ApplyAckResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query<{ id: string; status: CommandStatus }>(
        `SELECT id, status FROM commands WHERE cmd_id = $1 FOR UPDATE`,
        [input.cmdId]
      );
      const command = rows[0];
      if (!command) {
        await client.query("ROLLBACK");
        return { applied: false, unknownCommand: true };
      }

      // Dedup por el msgId del ack: un reintento QoS 1 del mismo ack no
      // debe añadir dos líneas a la bitácora.
      const { rowCount } = await client.query(
        `INSERT INTO command_log (command_id, msg_id, status, reason, occurred_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (msg_id) DO NOTHING`,
        [command.id, input.msgId, input.status, input.reason ?? null, input.occurredAt]
      );

      if (rowCount === 0) {
        await client.query("ROLLBACK");
        return { applied: false, unknownCommand: false };
      }

      // Un ack tardío de "delivered" no debe pisar un "executed" que ya
      // llegó: los estados solo avanzan.
      const yaTerminado = command.status === "executed" || command.status === "rejected";
      if (!yaTerminado) {
        await client.query(
          `UPDATE commands
              SET status = $2, reason = COALESCE($3, reason),
                  ${TIMESTAMP_COLUMN[input.status]} = $4
            WHERE id = $1`,
          [command.id, input.status, input.reason ?? null, input.occurredAt]
        );
      }

      await client.query("COMMIT");
      return { applied: true, unknownCommand: false };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async list(limit: number): Promise<CommandRecord[]> {
    const { rows } = await this.pool.query<CommandRow>(
      `${COMMAND_SELECT} ORDER BY c.sent_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map(toRecord);
  }

  async listLog(limit: number): Promise<CommandLogEntry[]> {
    const { rows } = await this.pool.query<{
      id: string;
      command_id: string;
      cmd_id: string;
      action: CmdAction;
      node_code: string;
      email: string;
      status: CommandStatus;
      reason: string | null;
      occurred_at: Date;
    }>(
      `SELECT l.id, l.command_id, c.cmd_id, c.action, n.node_code, u.email,
              l.status, l.reason, l.occurred_at
         FROM command_log l
         JOIN commands c ON c.id = l.command_id
         JOIN nodes n ON n.id = c.target_node_id
         JOIN users u ON u.id = c.issued_by_user_id
        ORDER BY l.occurred_at DESC
        LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      id: r.id,
      commandId: r.command_id,
      cmdId: r.cmd_id,
      action: r.action,
      targetNodeCode: r.node_code,
      issuedByEmail: r.email,
      status: r.status,
      reason: r.reason,
      occurredAt: r.occurred_at,
    }));
  }
}
