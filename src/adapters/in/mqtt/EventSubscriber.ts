import type { MqttClient } from "mqtt";
import type { FastifyBaseLogger } from "fastify";

import type { IngestEvent } from "../../../application/ingestEvent.js";
import type { VerifyNodeSecret } from "../../../application/verifyNodeSecret.js";
import { eventMessageSchema } from "./messageSchemas.js";

const EVENT_TOPIC_FILTER = "sitciit/+/event";

/**
 * Se engancha al cliente MQTT que ya abrió el suscriptor de telemetría en
 * vez de abrir otra conexión: un solo clientId por proceso (el broker
 * desconecta clientIds duplicados, ver ADR 0002 de sit-ciit-infra).
 */
export function attachEventSubscriber(
  client: MqttClient,
  ingestEvent: IngestEvent,
  verifyNodeSecret: VerifyNodeSecret,
  logger: FastifyBaseLogger
): void {
  function subscribe() {
    client.subscribe(EVENT_TOPIC_FILTER, { qos: 1 }, (err) => {
      if (err) logger.error({ err }, "mqtt: fallo al suscribirse a event");
      else logger.info("mqtt: suscrito a %s", EVENT_TOPIC_FILTER);
    });
  }

  if (client.connected) subscribe();
  client.on("connect", subscribe);

  client.on("message", (topic, payload) => {
    if (!topic.endsWith("/event")) return;
    void handle(topic, payload);
  });

  async function handle(topic: string, payload: Buffer) {
    let json: unknown;
    try {
      json = JSON.parse(payload.toString("utf-8"));
    } catch {
      logger.warn({ topic }, "mqtt: event no es JSON válido, descartado");
      return;
    }

    const parsed = eventMessageSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { topic, issues: parsed.error.issues },
        "mqtt: event no cumple el contrato, descartado"
      );
      return;
    }

    const okSecret = await verifyNodeSecret(parsed.data.nodeId, parsed.data.nodeSecret);
    if (!okSecret) {
      logger.warn({ topic, nodeId: parsed.data.nodeId }, "mqtt: secreto de nodo inválido, descartado");
      return;
    }

    try {
      const result = await ingestEvent(parsed.data);
      logger.info(
        { topic, msgId: parsed.data.msgId, kind: parsed.data.kind, inserted: result.inserted },
        result.inserted ? "mqtt: event guardado" : "mqtt: event duplicado, omitido"
      );
    } catch (err) {
      logger.error({ topic, err }, "mqtt: error guardando event");
    }
  }
}
