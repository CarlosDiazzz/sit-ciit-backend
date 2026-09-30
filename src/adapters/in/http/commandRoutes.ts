import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import type { IssueCommand } from "../../../application/issueCommand.js";
import type { CommandRepository } from "../../../domain/ports/CommandRepository.js";
import type { IssuerRole } from "../../../contract/contract.js";

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

/**
 * Identifica quién emite el comando.
 *
 * El login con JWT es Fase 6. Hasta entonces el emisor viaja en la
 * cabecera `x-user-email`, que se valida contra la tabla `users`: el
 * usuario debe existir y su rol sale de la base, no de la petición —
 * así el cliente no puede declararse `control_center` por su cuenta.
 *
 * Esto NO es autenticación (no hay contraseña de por medio) y debe
 * reemplazarse por el JWT en Fase 6; la validación de autoridad que
 * viene después sí es la definitiva.
 */
async function resolveIssuer(
  pool: Pool,
  email: unknown
): Promise<{ userId: string; role: IssuerRole } | null> {
  if (typeof email !== "string" || email.length === 0) return null;
  const { rows } = await pool.query<{ id: string; role: IssuerRole }>(
    `SELECT id, role FROM users WHERE email = $1`,
    [email]
  );
  const user = rows[0];
  return user ? { userId: user.id, role: user.role } : null;
}

export function registerCommandRoutes(
  app: FastifyInstance,
  pool: Pool,
  issueCommand: IssueCommand,
  commands: CommandRepository
): void {
  app.post("/commands", async (request, reply) => {
    const parsed = issueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "cuerpo inválido", issues: parsed.error.issues });
    }

    const issuer = await resolveIssuer(pool, request.headers["x-user-email"]);
    if (!issuer) {
      return reply
        .code(401)
        .send({ error: "no identificado", message: "Falta la cabecera x-user-email o el usuario no existe." });
    }

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
