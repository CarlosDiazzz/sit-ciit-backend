import type { FastifyInstance } from 'fastify';
import { RateLimiter } from '../security/RateLimiter.js';
export function registerRateLimits(app: FastifyInstance) {
  const requests = new RateLimiter(120, 60000);
  const logins = new RateLimiter(10, 60000);
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS' || request.url.split('?')[0] === '/health') return;
    const general = requests.take(request.ip);
    const result = general.allowed && request.method === 'POST' && request.url.split('?')[0] === '/auth/login'
      ? logins.take(request.ip) : general;
    if (!result.allowed) return reply.code(429).header('Retry-After', result.retryAfter).send({ message: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' });
  });
}
