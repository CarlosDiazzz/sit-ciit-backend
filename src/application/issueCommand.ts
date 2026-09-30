import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  isActionAllowedForRole,
  type CmdAction,
  type IssuerRole,
} from "../contract/contract.js";
import type {
  CommandRecord,
  CommandRepository,
} from "../domain/ports/CommandRepository.js";
import type { CommandPublisher } from "../domain/ports/CommandPublisher.js";

export interface IssueCommandInput {
  targetNodeCode: string;
  action: CmdAction;
  params?: Record<string, unknown>;
  issuedBy: { userId: string; role: IssuerRole };
}

export type IssueCommandResult =
  | { ok: true; command: CommandRecord }
  | { ok: false; error: "forbidden" | "unknown_node" };

export type IssueCommand = (input: IssueCommandInput) => Promise<IssueCommandResult>;

/**
 * Emite un comando hacia un nodo.
 *
 * La autoridad se valida **aquí**, antes de publicar: es la primera
 * línea de defensa (CLAUDE.md). El nodo revalida y puede responder
 * `rejected`, pero nunca se le delega la decisión — un nodo comprometido
 * no debe poder ejecutar lo que el rol no permite.
 */
export function makeIssueCommand(
  repo: CommandRepository,
  publisher: CommandPublisher,
  logger: { info: (obj: object, msg: string) => void }
): IssueCommand {
  return async function issueCommand(input) {
    if (!isActionAllowedForRole(input.action, input.issuedBy.role)) {
      logger.info(
        { action: input.action, role: input.issuedBy.role },
        "commands: accion no permitida para el rol, rechazada antes de publicar"
      );
      return { ok: false, error: "forbidden" };
    }

    const cmdId = randomUUID();
    const issuedAt = new Date();
    const params = input.params ?? {};

    // Se persiste antes de publicar: si el proceso muere entre ambos
    // pasos, queda registro de la intención en vez de un comando en
    // vuelo del que nadie sabe nada.
    const command = await repo.issue({
      cmdId,
      targetNodeCode: input.targetNodeCode,
      issuedByUserId: input.issuedBy.userId,
      issuedByRole: input.issuedBy.role,
      action: input.action,
      params,
      issuedAt,
    });

    if (command === null) return { ok: false, error: "unknown_node" };

    await publisher.publish({
      contractVersion: CONTRACT_VERSION,
      cmdId,
      targetNodeId: input.targetNodeCode,
      issuedBy: input.issuedBy,
      action: input.action,
      params,
      issuedAt: issuedAt.getTime(),
    });

    logger.info(
      { cmdId, action: input.action, node: input.targetNodeCode },
      "commands: comando publicado"
    );
    return { ok: true, command };
  };
}
