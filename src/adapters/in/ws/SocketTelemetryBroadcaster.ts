import type { Pool } from "pg";
import { verifyToken } from "../../../domain/jwt.js";
import { loadActor, unitIds } from "../http/management/access.js";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";

import type {
  ActiveNodePayload,
  CommandUpdatePayload,
  EventPayload,
  NodeStatusPayload,
  StatusBroadcaster,
  TelemetryBroadcastPayload,
  TelemetryBroadcaster,
} from "../../../domain/ports/TelemetryBroadcaster.js";

export class SocketTelemetryBroadcaster
  implements TelemetryBroadcaster, StatusBroadcaster
{
  private readonly io: SocketIOServer;

  constructor(
    httpServer: HttpServer,
    private readonly pool: Pool,
  ) {
    // CORS abierto: el dashboard (Vite) corre en otro puerto en dev y
    // todavía no hay auth de por medio (eso es Fase 6). Restringir el
    // origen cuando se agregue autenticación al dashboard.
    this.io = new SocketIOServer(httpServer, {
      cors: { origin: "*" },
    });
    this.io.use(async (socket, next) => {
      try {
        const token = verifyToken(socket.handshake.auth.token ?? "");
        const actor = token ? await loadActor(this.pool, token.id) : null;
        if (!actor || actor.role === "cliente")
          return next(new Error("No autorizado"));
        next();
      } catch {
        next(new Error("No autorizado"));
      }
    });
  }

  broadcast(payload: TelemetryBroadcastPayload): void {
    this.emitScoped("telemetry", payload, payload.unitId);
  }

  nodeStatus(payload: NodeStatusPayload): void {
    this.emitScoped("node:status", payload, payload.unitId);
  }

  activeNode(payload: ActiveNodePayload): void {
    this.emitScoped("unit:active-node", payload, payload.unitId);
  }

  commandUpdate(payload: CommandUpdatePayload): void {
    this.emitScoped("command:update", payload, undefined, payload.nodeId);
  }

  event(payload: EventPayload): void {
    this.emitScoped("event", payload, payload.unitId);
  }
  private emitScoped(
    event: string,
    payload: unknown,
    unitCode?: string,
    nodeCode?: string,
  ): void {
    void (async () => {
      const result = await this.pool.query(
        unitCode
          ? "SELECT id FROM units WHERE unit_code=$1"
          : "SELECT unit_id id FROM nodes WHERE node_code=$1",
        [unitCode ?? nodeCode],
      );
      const id = result.rows[0]?.id;
      if (!id) return;
      await Promise.all(
        [...this.io.sockets.sockets.values()].map(async (socket) => {
          const token = verifyToken(socket.handshake.auth.token ?? "");
          const actor = token ? await loadActor(this.pool, token.id) : null;
          if (!actor || actor.role === "cliente") {
            socket.disconnect(true);
            return;
          }
          const ids = await unitIds(this.pool, actor);
          if (ids === null || ids.includes(id)) socket.emit(event, payload);
        }),
      );
    })().catch(() => {
      /* No publicar datos cuando no se puede verificar el permiso. */
    });
  }
}
