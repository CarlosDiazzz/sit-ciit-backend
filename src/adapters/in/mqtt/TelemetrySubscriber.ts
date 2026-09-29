import mqtt, { type MqttClient } from "mqtt";
import type { FastifyBaseLogger } from "fastify";

import type { IngestTelemetry } from "../../../application/ingestTelemetry.js";
import { telemetryMessageSchema } from "./messageSchemas.js";

const TELEMETRY_TOPIC_FILTER = "sitciit/+/telemetry";

export interface MqttConnectionOptions {
  url: string;
  username: string;
  password: string;
}

export function startTelemetrySubscriber(
  opts: MqttConnectionOptions,
  ingestTelemetry: IngestTelemetry,
  logger: FastifyBaseLogger
): MqttClient {
  const client = mqtt.connect(opts.url, {
    username: opts.username,
    password: opts.password,
    clientId: `sit-ciit-backend-${process.pid}`,
    clean: true,
  });

  client.on("connect", () => {
    logger.info("mqtt: conectado, suscribiendo a %s", TELEMETRY_TOPIC_FILTER);
    client.subscribe(TELEMETRY_TOPIC_FILTER, { qos: 1 }, (err) => {
      if (err) logger.error({ err }, "mqtt: fallo al suscribirse");
    });
  });

  client.on("message", (topic, payload) => {
    void handleMessage(topic, payload);
  });

  client.on("error", (err) => logger.error({ err }, "mqtt: error de conexión"));
  client.on("reconnect", () => logger.warn("mqtt: reconectando"));

  async function handleMessage(topic: string, payload: Buffer) {
    let json: unknown;
    try {
      json = JSON.parse(payload.toString("utf-8"));
    } catch {
      logger.warn({ topic }, "mqtt: payload no es JSON válido, descartado");
      return;
    }

    const parsed = telemetryMessageSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { topic, issues: parsed.error.issues },
        "mqtt: mensaje no cumple el contrato, descartado"
      );
      return;
    }

    try {
      const result = await ingestTelemetry(parsed.data);
      logger.info(
        { topic, msgId: parsed.data.msgId, nodeId: parsed.data.nodeId, inserted: result.inserted },
        result.inserted ? "mqtt: telemetry guardada" : "mqtt: telemetry duplicada, omitida"
      );
    } catch (err) {
      logger.error({ topic, err }, "mqtt: error guardando telemetry");
    }
  }

  return client;
}
