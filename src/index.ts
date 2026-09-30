import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";

import { makeEvaluateLiveness } from "./application/evaluateLiveness.js";
import { makeIngestHeartbeat } from "./application/ingestHeartbeat.js";
import { makeIngestTelemetry } from "./application/ingestTelemetry.js";
import { makeIssueCommand } from "./application/issueCommand.js";
import { makeIngestEvent } from "./application/ingestEvent.js";
import { PgTelemetryRepository } from "./adapters/out/postgres/PgTelemetryRepository.js";
import { PgUnitRepository } from "./adapters/out/postgres/PgUnitRepository.js";
import { PgNodeStateRepository } from "./adapters/out/postgres/PgNodeStateRepository.js";
import { PgEventRepository } from "./adapters/out/postgres/PgEventRepository.js";
import { PgCommandRepository } from "./adapters/out/postgres/PgCommandRepository.js";
import { MqttCommandPublisher } from "./adapters/out/mqtt/MqttCommandPublisher.js";
import { startTelemetrySubscriber } from "./adapters/in/mqtt/TelemetrySubscriber.js";
import { attachHeartbeatSubscriber } from "./adapters/in/mqtt/HeartbeatSubscriber.js";
import { attachEventSubscriber } from "./adapters/in/mqtt/EventSubscriber.js";
import { startLivenessWatcher } from "./adapters/in/scheduler/livenessWatcher.js";
import { attachAckSubscriber } from "./adapters/in/mqtt/AckSubscriber.js";
import { registerCommandRoutes } from "./adapters/in/http/commandRoutes.js";
import { registerTelemetryRoutes } from "./adapters/in/http/telemetryRoutes.js";
import { registerUnitRoutes } from "./adapters/in/http/unitRoutes.js";
import { registerEventRoutes } from "./adapters/in/http/eventRoutes.js";
import { SocketTelemetryBroadcaster } from "./adapters/in/ws/SocketTelemetryBroadcaster.js";

const app = Fastify({ logger: true });

const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });

const telemetryRepository = new PgTelemetryRepository(pool);
const unitRepository = new PgUnitRepository(pool);
const nodeStateRepository = new PgNodeStateRepository(pool);
const eventRepository = new PgEventRepository(pool);
const commandRepository = new PgCommandRepository(pool);
const telemetryBroadcaster = new SocketTelemetryBroadcaster(app.server);
const ingestTelemetry = makeIngestTelemetry(telemetryRepository, telemetryBroadcaster);
const ingestHeartbeat = makeIngestHeartbeat(
  nodeStateRepository,
  eventRepository,
  telemetryBroadcaster,
  app.log
);
const evaluateLiveness = makeEvaluateLiveness(
  nodeStateRepository,
  eventRepository,
  telemetryBroadcaster,
  app.log
);
const ingestEvent = makeIngestEvent(eventRepository, telemetryBroadcaster);

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

// Un solo cliente MQTT por proceso: el broker desconecta clientIds
// duplicados (ADR 0002 de sit-ciit-infra).
attachHeartbeatSubscriber(mqttClient, ingestHeartbeat, app.log);
attachAckSubscriber(mqttClient, commandRepository, telemetryBroadcaster, app.log);

const issueCommand = makeIssueCommand(
  commandRepository,
  new MqttCommandPublisher(mqttClient),
  app.log
);
attachEventSubscriber(mqttClient, ingestEvent, app.log);
const livenessTimer = startLivenessWatcher(evaluateLiveness, app.log);

app.get("/health", async () => ({ status: "ok" }));
registerTelemetryRoutes(app, pool);
registerUnitRoutes(app, unitRepository);
registerCommandRoutes(app, pool, issueCommand, commandRepository);
registerEventRoutes(app, eventRepository);

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

async function shutdown() {
  app.log.info("apagando...");
  clearInterval(livenessTimer);
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
