import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";

import type {
  ActiveNodePayload,
  NodeStatusPayload,
  StatusBroadcaster,
  TelemetryBroadcastPayload,
  TelemetryBroadcaster,
} from "../../../domain/ports/TelemetryBroadcaster.js";

export class SocketTelemetryBroadcaster implements TelemetryBroadcaster, StatusBroadcaster {
  private readonly io: SocketIOServer;

  constructor(httpServer: HttpServer) {
    // CORS abierto: el dashboard (Vite) corre en otro puerto en dev y
    // todavía no hay auth de por medio (eso es Fase 6). Restringir el
    // origen cuando se agregue autenticación al dashboard.
    this.io = new SocketIOServer(httpServer, {
      cors: { origin: "*" },
    });
  }

  broadcast(payload: TelemetryBroadcastPayload): void {
    this.io.emit("telemetry", payload);
  }

  nodeStatus(payload: NodeStatusPayload): void {
    this.io.emit("node:status", payload);
  }

  activeNode(payload: ActiveNodePayload): void {
    this.io.emit("unit:active-node", payload);
  }
}
