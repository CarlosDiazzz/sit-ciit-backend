import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Login } from "../../../application/login.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, login: Login): void {
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "body inválido", issues: parsed.error.issues });
    }

    const result = await login(parsed.data.email, parsed.data.password);
    if (!result) {
      return reply.code(401).send({ error: "credenciales inválidas" });
    }

    return {
      token: result.token,
      user: { ...result.user, createdAt: result.user.createdAt.toISOString() },
    };
  });
}
