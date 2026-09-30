import type { FastifyReply, FastifyRequest } from "fastify";

import { verifyToken, type TokenPayload } from "../../../domain/jwt.js";
import type { UserRole } from "../../../domain/ports/UserRepository.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Puesto por requireRole tras verificar el JWT — undefined si la
     *  ruta no tiene el preHandler (no asumir que siempre existe). */
    authUser?: TokenPayload;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

/** preHandler de Fastify: exige un JWT válido y, si se dan roles, que el
 *  del token esté entre los permitidos. 401 sin token/token inválido,
 *  403 con token válido pero rol no autorizado. */
export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    const payload = token ? verifyToken(token) : null;

    if (!payload) {
      return reply.code(401).send({ error: "no autenticado", message: "Falta un token válido." });
    }

    if (roles.length > 0 && !roles.includes(payload.role)) {
      return reply.code(403).send({
        error: "no autorizado",
        message: `El rol ${payload.role} no puede acceder a esto.`,
      });
    }

    request.authUser = payload;
  };
}
