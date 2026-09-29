import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";

import { makeIngestTelemetry } from "./application/ingestTelemetry.js";
import { PgTelemetryRepository } from "./adapters/out/postgres/PgTelemetryRepository.js";
import { PgUnitRepository } from "./adapters/out/postgres/PgUnitRepository.js";
import { startTelemetrySubscriber } from "./adapters/in/mqtt/TelemetrySubscriber.js";
import { registerTelemetryRoutes } from "./adapters/in/http/telemetryRoutes.js";
import { registerUnitRoutes } from "./adapters/in/http/unitRoutes.js";
import { SocketTelemetryBroadcaster } from "./adapters/in/ws/SocketTelemetryBroadcaster.js";

const app = Fastify({ logger: true });

const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });

const telemetryRepository = new PgTelemetryRepository(pool);
const unitRepository = new PgUnitRepository(pool);
const telemetryBroadcaster = new SocketTelemetryBroadcaster(app.server);
const ingestTelemetry = makeIngestTelemetry(telemetryRepository, telemetryBroadcaster);

const mqttClient = startTelemetrySubscriber(
  {
    url: requireEnv("MQTT_URL"),
    username: requireEnv("MQTT_USERNAME"),
    password: requireEnv("MQTT_PASSWORD"),
  },
  ingestTelemetry,
  app.log
);

// El dashboard (Vite) corre en otro puerto en dev, asi que el navegador
// manda preflight OPTIONS. Sin CORS registrado esas peticiones fallan con
// 404. Origen abierto mientras no hay auth (Fase 6); restringirlo al
// agregarla, igual que en SocketTelemetryBroadcaster.
await app.register(cors, { origin: true });

app.get("/health", async () => ({ status: "ok" }));
registerTelemetryRoutes(app, pool);
registerUnitRoutes(app, unitRepository);

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

async function shutdown() {
  app.log.info("apagando...");
  mqttClient.end(true);
  await pool.end();
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`falta la variable de entorno ${name}`);
  return value;
}
