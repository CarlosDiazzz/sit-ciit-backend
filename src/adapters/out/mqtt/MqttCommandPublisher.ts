import type { MqttClient } from "mqtt";

import type { CmdMessage } from "../../../contract/contract.js";
import type { CommandPublisher } from "../../../domain/ports/CommandPublisher.js";

/**
 * Publica en `sitciit/{nodeId}/cmd` con QoS 1, reutilizando el cliente
 * MQTT que ya abrieron los suscriptores: un solo clientId por proceso,
 * porque el broker desconecta duplicados (ADR 0002 de sit-ciit-infra).
 */
export class MqttCommandPublisher implements CommandPublisher {
  constructor(private readonly client: MqttClient) {}

  publish(cmd: CmdMessage): Promise<void> {
    const topic = `sitciit/${cmd.targetNodeId}/cmd`;
    const payload = JSON.stringify(cmd);

    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
