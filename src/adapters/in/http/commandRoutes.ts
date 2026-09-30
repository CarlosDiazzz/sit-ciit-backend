import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { IssueCommand } from "../../../application/issueCommand.js";
import type { CommandRepository } from "../../../domain/ports/CommandRepository.js";
import type { IssuerRole } from "../../../contract/contract.js";
import { requireRole } from "./authGuard.js";

const issueSchema = z.object({
  targetNodeId: z.string().min(1),
  action: z.enum([
    "set_sampling_rate",
    "set_thresholds",
    "trigger_alarm",
    "stop_alarm",
    "set_mode",
    "toggle_sensor",
  ]),
  params: z.record(z.unknown()).optional(),
});

export function registerCommandRoutes(
  app: FastifyInstance,
  issueCommand: IssueCommand,
  commands: CommandRepository
): void {
  app.post("/commands", { preHandler: requireRole("control_center", "operator") }, async (request, reply) => {
    const parsed = issueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "cuerpo inválido", issues: parsed.error.issues });
    }

    // requireRole ya garantizó que el rol es control_center u operator —
    // cliente nunca llega aquí, así que el cast a IssuerRole es seguro.
    const issuer = { userId: request.authUser!.id, role: request.authUser!.role as IssuerRole };

    const result = await issueCommand({
      targetNodeCode: parsed.data.targetNodeId,
      action: parsed.data.action,
      params: parsed.data.params,
      issuedBy: issuer,
    });

    if (!result.ok) {
      if (result.error === "forbidden") {
        return reply.code(403).send({
          error: "no autorizado",
          message: `El rol ${issuer.role} no puede ejecutar ${parsed.data.action}.`,
        });
      }
      return reply.code(404).send({
        error: "nodo desconocido",
        message: `No hay ningún nodo dado de alta con el código ${parsed.data.targetNodeId}.`,
      });
    }

    return reply.code(201).send(result.command);
  });

  app.get("/commands", async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 100);
    return commands.list(Number.isFinite(limit) ? Math.min(limit, 500) : 100);
  });

  app.get("/command-log", async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 200);
    return commands.listLog(Number.isFinite(limit) ? Math.min(limit, 500) : 200);
  });
}
