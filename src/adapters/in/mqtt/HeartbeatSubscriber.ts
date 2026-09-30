import type { MqttClient } from "mqtt";
import type { FastifyBaseLogger } from "fastify";

import type { IngestHeartbeat } from "../../../application/ingestHeartbeat.js";
import type { VerifyNodeSecret } from "../../../application/verifyNodeSecret.js";
import { heartbeatMessageSchema } from "./messageSchemas.js";

const HEARTBEAT_TOPIC_FILTER = "sitciit/+/heartbeat";

/**
 * Se engancha al cliente MQTT que ya abrió el suscriptor de telemetría
 * en vez de abrir otra conexión: un solo clientId por proceso (el broker
 * desconecta clientIds duplicados, ver ADR 0002 de sit-ciit-infra).
 */
export function attachHeartbeatSubscriber(
  client: MqttClient,
  ingestHeartbeat: IngestHeartbeat,
  verifyNodeSecret: VerifyNodeSecret,
  logger: FastifyBaseLogger
): void {
  function subscribe() {
    client.subscribe(HEARTBEAT_TOPIC_FILTER, { qos: 1 }, (err) => {
      if (err) logger.error({ err }, "mqtt: fallo al suscribirse a heartbeat");
      else logger.info("mqtt: suscrito a %s", HEARTBEAT_TOPIC_FILTER);
    });
  }

  // Si la conexión ya está lista, "connect" no volverá a dispararse.
  if (client.connected) subscribe();
  client.on("connect", subscribe);

  client.on("message", (topic, payload) => {
    if (!topic.endsWith("/heartbeat")) return;
    void handle(topic, payload);
  });

  async function handle(topic: string, payload: Buffer) {
    let json: unknown;
    try {
      json = JSON.parse(payload.toString("utf-8"));
    } catch {
      logger.warn({ topic }, "mqtt: heartbeat no es JSON válido, descartado");
      return;
    }

    const parsed = heartbeatMessageSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { topic, issues: parsed.error.issues },
        "mqtt: heartbeat no cumple el contrato, descartado"
      );
      return;
    }

    const okSecret = await verifyNodeSecret(parsed.data.nodeId, parsed.data.nodeSecret);
    if (!okSecret) {
      logger.warn({ topic, nodeId: parsed.data.nodeId }, "mqtt: secreto de nodo inválido, descartado");
      return;
    }

    try {
      await ingestHeartbeat(parsed.data);
    } catch (err) {
      logger.error({ topic, err }, "mqtt: error procesando heartbeat");
    }
  }
}
