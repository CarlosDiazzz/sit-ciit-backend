import type { CmdAction, IssuerRole } from "../../contract/contract.js";

export type CommandStatus = "sent" | "delivered" | "executed" | "rejected";

export interface CommandToIssue {
  cmdId: string;
  targetNodeCode: string;
  issuedByUserId: string;
  issuedByRole: IssuerRole;
  action: CmdAction;
  params: Record<string, unknown>;
  issuedAt: Date;
}

export interface CommandRecord {
  id: string;
  cmdId: string;
  targetNodeCode: string;
  issuedByEmail: string;
  issuedByRole: IssuerRole;
  action: CmdAction;
  params: Record<string, unknown>;
  status: CommandStatus;
  reason: string | null;
  issuedAt: Date;
  sentAt: Date;
  deliveredAt: Date | null;
  executedAt: Date | null;
  rejectedAt: Date | null;
}

export interface CommandLogEntry {
  id: string;
  commandId: string;
  cmdId: string;
  action: CmdAction;
  targetNodeCode: string;
  issuedByEmail: string;
  status: CommandStatus;
  reason: string | null;
  occurredAt: Date;
}

/** Resultado de aplicar un ack; `unknownCommand` distingue un ack de un
 *  cmdId que no conocemos (nodo reiniciado, comando de otra sesión) de
 *  un duplicado legítimo. */
export interface ApplyAckResult {
  applied: boolean;
  unknownCommand: boolean;
}

export interface CommandRepository {
  /** Guarda el comando como `sent` y abre su bitácora. Devuelve null si
   *  el nodo destino no existe. */
  issue(cmd: CommandToIssue): Promise<CommandRecord | null>;

  /** Aplica un ack del nodo: mueve el estado y añade una línea al log.
   *  Deduplica por el msgId del ack. */
  applyAck(input: {
    cmdId: string;
    msgId: string;
    status: Exclude<CommandStatus, "sent">;
    reason?: string;
    occurredAt: Date;
  }): Promise<ApplyAckResult>;

  list(limit: number): Promise<CommandRecord[]>;

  listLog(limit: number): Promise<CommandLogEntry[]>;
}
