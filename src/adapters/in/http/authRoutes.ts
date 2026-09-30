import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Login } from "../../../application/login.js";
import type { NotificationPort } from "../../../domain/ports/NotificationPort.js";
import { avisoDeSesion } from "../../../domain/avisos.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  login: Login,
  notificador: NotificationPort,
): void {
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "body inválido", issues: parsed.error.issues });
    }

    const result = await login(parsed.data.email, parsed.data.password);
    if (!result) {
      return reply.code(401).send({ error: "credenciales inválidas" });
    }

    // El aviso no se espera ni puede impedir la entrada: si el correo
    // falla, el usuario igual inició sesión y ya tiene su token.
    const aviso = avisoDeSesion({
      email: result.user.email,
      cuando: new Date(),
    });
    void notificador
      .send({ to: result.user.email, ...aviso })
      .then((r) => {
        if (!r.sent) app.log.warn({ err: r.error }, "aviso de sesión no enviado");
      })
      .catch((err) => app.log.warn({ err }, "aviso de sesión no enviado"));

    return {
      token: result.token,
      user: { ...result.user, createdAt: result.user.createdAt.toISOString() },
    };
  });
}
