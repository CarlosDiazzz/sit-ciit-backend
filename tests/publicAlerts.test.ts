import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import Fastify from 'fastify';
import { RateLimiter } from '../src/adapters/in/security/RateLimiter.js';
import { registerRateLimits } from '../src/adapters/in/http/rateLimit.js';
import { SocketTelemetryBroadcaster } from '../src/adapters/in/ws/SocketTelemetryBroadcaster.js';

function wait(socket: Socket, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${event}`)), 3000);
    socket.once(event, (value) => { clearTimeout(timeout); resolve(value); });
  });
}

test('rate limiter resets windows, isolates IPs and bounds storage', () => {
  const limiter = new RateLimiter(2, 1000, 2);
  assert.equal(limiter.take('a', 0).allowed, true);
  assert.equal(limiter.take('a', 0).allowed, true);
  assert.deepEqual(limiter.take('a', 500), { allowed: false, retryAfter: 1 });
  assert.equal(limiter.take('b', 500).allowed, true);
  assert.equal(limiter.take('c', 500).allowed, false);
  assert.equal(limiter.take('c', 1000).allowed, true);
  assert.equal(limiter.take('a', 1000).allowed, false);
  assert.equal(limiter.take('a', 1500).allowed, true);
});

test('HTTP limits return 429 and Retry-After, including failed logins', async () => {
  const app = Fastify();
  registerRateLimits(app);
  app.post('/auth/login', (_req, reply) => reply.code(401).send({}));
  app.get('/data', async () => ({}));
  app.get('/health', async () => ({}));
  try {
    for (let i = 0; i < 10; i++) assert.equal((await app.inject({ method: 'POST', url: '/auth/login' })).statusCode, 401);
    const denied = await app.inject({ method: 'POST', url: '/auth/login' });
    assert.equal(denied.statusCode, 429);
    assert.ok(Number(denied.headers['retry-after']) > 0);
    for (let i = 0; i < 109; i++) assert.equal((await app.inject('/data')).statusCode, 200);
    assert.equal((await app.inject('/data')).statusCode, 429);
    assert.equal((await app.inject('/health')).statusCode, 200);
    assert.equal((await app.inject({ url: '/data', remoteAddress: '127.0.0.2' })).statusCode, 200);
  } finally { await app.close(); }
});

test('anonymous alerts omit GPS, private namespace rejects guests, connection cap recovers', async () => {
  const server = createServer();
  const broadcaster = new SocketTelemetryBroadcaster(server, { query: async () => ({ rows: [] }) } as unknown as Pool);
  const clients: Socket[] = [];
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client(namespace: string) {
    const socket = io(url + namespace, { autoConnect: false, forceNew: true, transports: ['websocket'], reconnection: false });
    clients.push(socket);
    return socket;
  }
  try {
    const guest = client('/alerts');
    const ready = wait(guest, 'connect'); guest.connect(); await ready;
    const received = wait(guest, 'event');
    broadcaster.event({ unitId: 'U1', nodeId: 'N1', kind: 'impact', severity: 'critical', ts: 1, gps: { lat: 1, lon: 2 }, value: 4 });
    assert.deepEqual(await received, { unitId: 'U1', nodeId: 'N1', kind: 'impact', severity: 'critical', ts: 1 });
    const privateSocket = client('');
    const denied = wait(privateSocket, 'connect_error'); privateSocket.connect();
    assert.match((await denied).message, /No autorizado/);
    for (let i = 0; i < 4; i++) { const socket = client('/alerts'); const connected = wait(socket, 'connect'); socket.connect(); await connected; }
    const overflow = client('/alerts'); const limit = wait(overflow, 'connect_error'); overflow.connect();
    assert.match((await limit).message, /Demasiadas conexiones/);
    guest.disconnect();
    await new Promise(resolve => setTimeout(resolve, 40));
    const replacement = client('/alerts'); const connected = wait(replacement, 'connect'); replacement.connect(); await connected;
  } finally { clients.forEach(socket => socket.disconnect()); await broadcaster.close(); }
});
