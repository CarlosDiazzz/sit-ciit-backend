import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  resources,
  profileKeys,
  type Resource,
} from "../../../../domain/management/resources.js";
import { hashPassword } from "../../../../domain/password.js";
import {
  ManagementError,
  assertUnit,
  assertTrip,
  unitIds,
  type Actor,
} from "./access.js";
type Row = Record<string, any>;
const safe = (r: Row) => {
  const { password_hash, secret_hash, ...rest } = r;
  return rest;
};
export async function audit(
  db: PoolClient,
  actor: Actor,
  resource: string,
  id: string,
  action: string,
  before: Row | null,
  after: Row | null,
) {
  await db.query(
    "INSERT INTO audit_log(actor_id,resource,record_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)",
    [
      actor.id,
      resource,
      id,
      action,
      before ? safe(before) : null,
      after ? safe(after) : null,
    ],
  );
}
export class ManagementStore {
  constructor(readonly pool: Pool) {}
  async transaction<T>(run: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const out = await run(db);
      await db.query("COMMIT");
      return out;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async scope(
    db: Pool | PoolClient,
    key: string,
    actor: Actor,
  ): Promise<{ sql: string; values: unknown[] }> {
    if (["admin", "control_center", "auditor"].includes(actor.role))
      return { sql: "true", values: [] };
    if (actor.role === "cliente") {
      if (key === "companies")
        return { sql: "r.id=$1", values: [actor.company_id] };
      if (key === "shipments")
        return { sql: "r.company_id=$1", values: [actor.company_id] };
      if (key === "trip-shipments")
        return {
          sql: "r.shipment_id IN (SELECT id FROM shipments WHERE company_id=$1)",
          values: [actor.company_id],
        };
      if (key === "trips")
        return {
          sql: "r.id IN (SELECT ts.trip_id FROM trip_shipments ts JOIN shipments s ON s.id=ts.shipment_id WHERE s.company_id=$1 AND ts.active)",
          values: [actor.company_id],
        };
      return { sql: "false", values: [] };
    }
    const ids = await unitIds(db, actor);
    if (key === "units") return { sql: "r.id=ANY($1::uuid[])", values: [ids] };
    if (["nodes", "incidents", "trips"].includes(key))
      return { sql: "r.unit_id=ANY($1::uuid[])", values: [ids] };
    if (key === "assignments")
      return { sql: "r.user_id=$1", values: [actor.id] };
    if (key === "maintenance")
      return { sql: "r.technician_id=$1", values: [actor.id] };
    if (key === "trip-shipments")
      return {
        sql: "r.trip_id IN (SELECT trip_id FROM assignments WHERE user_id=$1 AND active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>=now()))",
        values: [actor.id],
      };
    if (key === "shipments")
      return {
        sql: "r.id IN (SELECT ts.shipment_id FROM trip_shipments ts JOIN assignments a ON a.trip_id=ts.trip_id WHERE a.user_id=$1 AND a.active AND ts.active AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>=now()))",
        values: [actor.id],
      };
    // Catálogos geográficos y perfiles son datos de referencia para el personal.
    if (
      [
        "locations",
        "routes",
        "route-checkpoints",
        "cargo-types",
        "monitoring-profiles",
      ].includes(key)
    )
      return { sql: "true", values: [] };
    return { sql: "false", values: [] };
  }
  async list(
    key: string,
    actor: Actor,
    query: { page: number; limit: number; search?: string; archived?: boolean },
  ) {
    const res = resources[key]!;
    const scope = await this.scope(this.pool, key, actor);
    const values = [...scope.values];
    const terms = [scope.sql];
    if (!query.archived) terms.push("r.active");
    if (query.search) {
      values.push(`%${query.search}%`);
      const p = `$${values.length}`;
      const keys = res.fields
        .filter(
          (f) =>
            ["text", "email", "textarea"].includes(f.type) &&
            !profileKeys.includes(f.key),
        )
        .map((f) => `r.${f.key} ILIKE ${p}`);
      if (keys.length) terms.push(`(${keys.join(" OR ")})`);
    }
    const where = terms.join(" AND ");
    const count = await this.pool.query(
      `SELECT count(*)::int total FROM ${res.table} r WHERE ${where}`,
      values,
    );
    values.push(query.limit, (query.page - 1) * query.limit);
    const rows = await this.pool.query(
      `SELECT r.* ${key === "users" ? ",to_jsonb(p) AS profile" : ""} FROM ${res.table} r ${key === "users" ? "LEFT JOIN user_profiles p ON p.user_id=r.id" : ""} WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const items = rows.rows.map((r) =>
      key === "users"
        ? { ...safe(r), ...r.profile, profile: undefined }
        : safe(r),
    );
    await this.labels(this.pool, res, items);
    return {
      items,
      total: count.rows[0].total,
      page: query.page,
      limit: query.limit,
    };
  }
  async labels(db: Pool | PoolClient, res: Resource, items: Row[]) {
    for (const field of res.fields.filter((f) => f.type === "reference")) {
      const ids = [...new Set(items.map((r) => r[field.key]).filter(Boolean))];
      if (!ids.length) continue;
      const target =
        field.resource === "events"
          ? "events"
          : resources[field.resource!]!.table;
      const expression =
        target === "users"
          ? "coalesce(nullif(trim(concat(first_name,' ',last_name)),''),email)"
          : target === "units"
            ? "coalesce(label,unit_code)"
            : target === "nodes"
              ? "coalesce(label,node_code)"
              : target === "events"
                ? "kind||' · '||to_char(ts,'YYYY-MM-DD HH24:MI')"
                : [
                      "route_checkpoints",
                      "trip_shipments",
                      "assignments",
                    ].includes(target)
                  ? "id::text"
                  : "name";
      const { rows } = await db.query(
        `SELECT id,${expression} label FROM ${target} WHERE id=ANY($1::uuid[])`,
        [ids],
      );
      const labels = new Map(rows.map((r) => [r.id, r.label]));
      for (const item of items) {
        item._labels ??= {};
        item._labels[field.key] = labels.get(item[field.key]) ?? null;
      }
    }
  }
  async get(
    key: string,
    id: string,
    actor: Actor,
    db: Pool | PoolClient = this.pool,
    lock = false,
  ): Promise<Row> {
    const res = resources[key]!;
    const scope = await this.scope(db, key, actor);
    const values = [...scope.values, id];
    const { rows } = await db.query(
      `SELECT r.* FROM ${res.table} r WHERE (${scope.sql}) AND r.id=$${values.length} ${lock ? "FOR UPDATE" : ""}`,
      values,
    );
    if (!rows[0])
      throw new ManagementError(
        404,
        "Registro no encontrado o fuera de tu ámbito.",
      );
    const row = safe(rows[0]);
    if (key === "users") {
      const p = await db.query(
        "SELECT *,license_expires_on::text AS license_expires_on FROM user_profiles WHERE user_id=$1",
        [id],
      );
      Object.assign(row, p.rows[0] ?? {});
      delete row.user_id;
    }
    await this.labels(db, res, [row]);
    return row;
  }
  async references(db: PoolClient, res: Resource, data: Row) {
    for (const f of res.fields.filter((f) => f.type === "reference")) {
      if (!data[f.key]) continue;
      const table =
        f.resource === "events" ? "events" : resources[f.resource!]!.table;
      const { rows } = await db.query(
        `SELECT id FROM ${table} WHERE id=$1 ${table === "events" ? "" : "AND active"} FOR SHARE`,
        [data[f.key]],
      );
      if (!rows.length)
        throw new ManagementError(
          400,
          `${f.label}: selecciona un registro activo.`,
        );
    }
  }
  async validate(
    db: PoolClient,
    key: string,
    actor: Actor,
    data: Row,
    before: Row | null,
  ) {
    const changing = (k: string) => {
      if (!before) return true;
      const field = resources[key]!.fields.find((f) => f.key === k);
      if (field?.type === "datetime" && data[k] && before[k])
        return new Date(data[k]).getTime() !== new Date(before[k]).getTime();
      return data[k] !== before[k];
    };
    if ("origin_id" in data && data.origin_id === data.destination_id)
      throw new ManagementError(400, "Origen y destino deben ser diferentes.");
    for (const [a, b] of [
      ["planned_departure", "planned_arrival"],
      ["starts_at", "ends_at"],
    ])
      if (data[a] && data[b] && new Date(data[b]) < new Date(data[a]))
        throw new ManagementError(
          400,
          "La fecha final debe ser posterior a la inicial.",
        );
    if (key === "users") {
      if (
        (data.role === "admin" || before?.role === "admin") &&
        actor.role !== "admin"
      )
        throw new ManagementError(
          403,
          "Solo un administrador puede gestionar administradores.",
        );
      if (data.role === "cliente" && !data.company_id)
        throw new ManagementError(400, "El cliente necesita una empresa.");
      if (!before && !data.password)
        throw new ManagementError(
          400,
          "La contraseña es obligatoria al crear una cuenta.",
        );
      if (
        before?.id === actor.id &&
        (data.active === false || changing("role"))
      )
        throw new ManagementError(
          400,
          "No puedes desactivar tu cuenta ni cambiar tu propio rol.",
        );
      if (
        before &&
        ["admin", "control_center"].includes(before.role) &&
        (data.active === false ||
          !["admin", "control_center"].includes(data.role))
      ) {
        await db.query("SELECT pg_advisory_xact_lock(918273)");
        const { rows } = await db.query(
          "SELECT count(*)::int n FROM users WHERE active AND role IN ('admin','control_center') AND id<>$1",
          [before.id],
        );
        if (rows[0].n === 0)
          throw new ManagementError(
            409,
            "Debe quedar al menos una cuenta administradora activa.",
          );
      }
      if (data.field_function === "driver" && !data.license_number)
        throw new ManagementError(400, "Registra la licencia del conductor.");
    }
    if (
      key === "monitoring-profiles" &&
      data.min_temperature_c != null &&
      data.max_temperature_c != null &&
      data.min_temperature_c > data.max_temperature_c
    )
      throw new ManagementError(400, "La temperatura mínima supera la máxima.");
    if (key === "shipments") {
      const transitions: Record<string, string[]> = {
        draft: ["ready", "cancelled"],
        ready: ["draft", "cancelled"],
        in_transit: [],
        delivered: [],
        cancelled: [],
      };
      if (!before && !["draft", "ready"].includes(data.status ?? "draft"))
        throw new ManagementError(
          400,
          "Un envío nuevo debe estar en borrador o listo.",
        );
      if (
        before &&
        changing("status") &&
        !transitions[before.status]?.includes(data.status)
      )
        throw new ManagementError(
          409,
          "El estado del envío cambia mediante el inicio o finalización de sus viajes.",
        );
      if (
        before &&
        ["in_transit", "delivered", "cancelled"].includes(before.status) &&
        [
          "company_id",
          "cargo_type_id",
          "weight_kg",
          "origin_id",
          "destination_id",
        ].some(changing)
      )
        throw new ManagementError(
          409,
          "No puedes cambiar los datos de un envío que ya inició.",
        );
    }
    if (
      ["trips", "shipments"].includes(key) &&
      data.status === "cancelled" &&
      !data.cancellation_reason
    )
      throw new ManagementError(400, "Indica el motivo de cancelación.");
    if (key === "trips") {
      const transitions: Record<string, string[]> = {
        planned: ["in_transit", "cancelled"],
        in_transit: ["completed", "cancelled"],
        completed: [],
        cancelled: [],
      };
      if (!before && data.status !== "planned")
        throw new ManagementError(
          400,
          "Un viaje nuevo debe estar planificado.",
        );
      if (
        before &&
        changing("status") &&
        !transitions[before.status]?.includes(data.status)
      )
        throw new ManagementError(409, "Transición de viaje no permitida.");
      if (
        before &&
        before.status !== "planned" &&
        ["route_id", "unit_id", "planned_departure", "planned_arrival"].some(
          changing,
        )
      )
        throw new ManagementError(
          409,
          "El viaje iniciado conserva su unidad, ruta y planificación.",
        );
      if (data.status === "in_transit" && changing("status")) {
        const unit = await db.query(
          "SELECT * FROM units WHERE id=$1 FOR UPDATE",
          [data.unit_id],
        );
        if (unit.rows[0]?.status !== "available")
          throw new ManagementError(409, "La unidad no está disponible.");
        const assigned = await db.query(
          "SELECT id FROM assignments WHERE trip_id=$1 AND active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>=now())",
          [before?.id],
        );
        if (!assigned.rows.length)
          throw new ManagementError(
            409,
            "Asigna personal vigente antes de iniciar el viaje.",
          );
        const cargo = await db.query(
          `SELECT s.*,c.capacity_kg,c.status container_status FROM trip_shipments ts JOIN shipments s ON s.id=ts.shipment_id LEFT JOIN containers c ON c.id=ts.container_id WHERE ts.trip_id=$1 AND ts.active FOR UPDATE OF s`,
          [before?.id],
        );
        await db.query(
          "SELECT id FROM containers WHERE id IN (SELECT container_id FROM trip_shipments WHERE trip_id=$1 AND active) ORDER BY id FOR UPDATE",
          [before?.id],
        );
        if (
          !cargo.rows.length ||
          cargo.rows.some((s) => !s.active || s.status !== "ready")
        )
          throw new ManagementError(
            409,
            "El viaje debe tener envíos activos y listos.",
          );
        if (
          unit.rows[0].capacity_kg &&
          cargo.rows.reduce((n, s) => n + Number(s.weight_kg), 0) >
            unit.rows[0].capacity_kg
        )
          throw new ManagementError(
            409,
            "La carga excede la capacidad de la unidad.",
          );
        const busy = await db.query(
          `SELECT ts.id FROM trip_shipments ts JOIN trips t ON t.id=ts.trip_id WHERE ts.active AND t.active AND t.status='in_transit' AND t.id<>$1 AND (ts.shipment_id IN (SELECT shipment_id FROM trip_shipments WHERE trip_id=$1 AND active) OR ts.container_id IN (SELECT container_id FROM trip_shipments WHERE trip_id=$1 AND active))`,
          [before?.id],
        );
        if (busy.rows.length)
          throw new ManagementError(
            409,
            "Un envío o contenedor ya está en otro viaje en curso.",
          );
        if (
          cargo.rows.some(
            (s) => s.container_status && s.container_status !== "available",
          )
        )
          throw new ManagementError(409, "Un contenedor no está disponible.");
      }
    }
    if (key === "trip-shipments") {
      if (before && (changing("trip_id") || changing("shipment_id")))
        throw new ManagementError(
          409,
          "Archiva la relación y crea otra para cambiar viaje o envío.",
        );
      const trip = await db.query(
        "SELECT status,unit_id FROM trips WHERE id=$1 FOR UPDATE",
        [data.trip_id],
      );
      if (trip.rows[0]?.status !== "planned")
        throw new ManagementError(
          409,
          "Solo puedes cambiar la carga de un viaje planificado.",
        );
      const shipment = await db.query(
        "SELECT status,weight_kg FROM shipments WHERE id=$1",
        [data.shipment_id],
      );
      if (!["draft", "ready"].includes(shipment.rows[0]?.status))
        throw new ManagementError(409, "El envío ya inició o fue cancelado.");
      if (data.container_id) {
        const c = await db.query(
          "SELECT capacity_kg FROM containers WHERE id=$1 FOR UPDATE",
          [data.container_id],
        );
        const weights = await db.query(
          "SELECT coalesce(sum(s.weight_kg),0) total FROM trip_shipments ts JOIN shipments s ON s.id=ts.shipment_id WHERE ts.trip_id=$1 AND ts.container_id=$2 AND ts.active AND ts.id<>$3",
          [data.trip_id, data.container_id, before?.id ?? randomUUID()],
        );
        if (
          c.rows[0]?.capacity_kg &&
          Number(weights.rows[0].total) + Number(shipment.rows[0].weight_kg) >
            c.rows[0].capacity_kg
        )
          throw new ManagementError(
            409,
            "La carga excede la capacidad del contenedor.",
          );
      }
    }
    if (key === "units" && before && before.status !== data.status) {
      const running = await db.query(
        "SELECT id FROM trips WHERE unit_id=$1 AND status='in_transit' AND active",
        [before.id],
      );
      if (running.rows.length)
        throw new ManagementError(
          409,
          "El estado de esta unidad lo controla el viaje en curso.",
        );
    }
    if (key === "assignments") {
      if (before && (changing("trip_id") || changing("user_id")))
        throw new ManagementError(
          409,
          "Finaliza la asignación y crea otra para cambiar persona o viaje.",
        );
      const u = await db.query("SELECT role FROM users WHERE id=$1", [
        data.user_id,
      ]);
      const roles: Record<string, string[]> = {
        driver: ["operator"],
        custodian: ["operator"],
        supervisor: ["control_center", "admin", "auditor"],
        technician: ["technician"],
      };
      if (!roles[data.function]?.includes(u.rows[0]?.role))
        throw new ManagementError(
          400,
          "El rol de la persona no corresponde a esta función.",
        );
      const t = await db.query(
        "SELECT status FROM trips WHERE id=$1 FOR UPDATE",
        [data.trip_id],
      );
      if (["completed", "cancelled"].includes(t.rows[0]?.status))
        throw new ManagementError(409, "El viaje ya está cerrado.");
    }
    if (key === "maintenance") {
      if (actor.role === "technician" && (!before || changing("node_id")))
        throw new ManagementError(
          403,
          "El centro de control asigna tus mantenimientos y dispositivos.",
        );
      const user = await db.query("SELECT role FROM users WHERE id=$1", [
        data.technician_id,
      ]);
      if (user.rows[0]?.role !== "technician")
        throw new ManagementError(400, "Selecciona una cuenta de técnico.");
      if (actor.role === "technician" && data.technician_id !== actor.id)
        throw new ManagementError(
          403,
          "Solo puedes gestionar tus mantenimientos.",
        );
      if (data.status === "completed" && !data.result)
        throw new ManagementError(
          400,
          "Indica el resultado del mantenimiento.",
        );
    }
    if (key === "incidents") {
      await assertUnit(db, actor, data.unit_id);
      if (data.trip_id) {
        const trip = await db.query("SELECT unit_id FROM trips WHERE id=$1", [
          data.trip_id,
        ]);
        if (trip.rows[0]?.unit_id !== data.unit_id)
          throw new ManagementError(400, "El viaje no pertenece a la unidad.");
      }
      if (data.event_id) {
        const event = await db.query("SELECT unit_id FROM events WHERE id=$1", [
          data.event_id,
        ]);
        if (event.rows[0]?.unit_id !== data.unit_id)
          throw new ManagementError(400, "El evento no pertenece a la unidad.");
      }
      if (before && ["resolved", "dismissed"].includes(before.status))
        throw new ManagementError(
          409,
          "El incidente cerrado conserva su resolución.",
        );
      const transitions: Record<string, string[]> = {
        open: ["acknowledged", "in_progress", "resolved", "dismissed"],
        acknowledged: ["in_progress", "resolved", "dismissed"],
        in_progress: ["resolved", "dismissed"],
      };
      if (!before && data.status !== "open")
        throw new ManagementError(
          400,
          "Un incidente nuevo debe estar abierto.",
        );
      if (
        before &&
        changing("status") &&
        !transitions[before.status]?.includes(data.status)
      )
        throw new ManagementError(409, "Transición de incidente no permitida.");
      if (["resolved", "dismissed"].includes(data.status) && !data.resolution)
        throw new ManagementError(
          400,
          "Indica la resolución o el motivo de descarte.",
        );
      if (
        actor.role === "operator" &&
        data.assigned_to &&
        data.assigned_to !== actor.id
      )
        throw new ManagementError(
          403,
          "Solo el centro de control puede asignar incidentes a otra persona.",
        );
    }
  }
  async write(key: string, id: string | null, actor: Actor, input: Row) {
    const res = resources[key]!;
    if (res.fields.some((f) => f.generated && f.key in input))
      throw new ManagementError(400, "La guía se genera automáticamente y no se puede modificar.");
    return this.transaction(async (db) => {
      const before = id ? await this.get(key, id, actor, db, true) : null;
      const data = { ...before, ...input };
      await this.references(db, res, data);
      await this.validate(db, key, actor, data, before);
      const fields = new Set(res.fields.map((f) => f.key));
      const payload: Row = {};
      for (const [k, v] of Object.entries(input))
        if (
          (fields.has(k) && !profileKeys.includes(k) && k !== "password") ||
          k === "active"
        )
          payload[k] = v;
      if (input.password)
        payload.password_hash = await hashPassword(input.password);
      if (["monitoring-profiles", "routes"].includes(key) && before)
        payload.version = before.version + 1;
      if (
        key === "incidents" &&
        ["resolved", "dismissed"].includes(data.status)
      )
        payload.resolved_at = new Date();
      if (key === "maintenance" && data.status === "completed")
        payload.completed_at = new Date();
      if (key === "trips" && before && data.status !== before.status) {
        if (data.status === "in_transit") {
          payload.actual_departure = new Date();
          const r = await db.query("SELECT * FROM routes WHERE id=$1", [
            data.route_id,
          ]);
          const checkpoints = await db.query(
            "SELECT * FROM route_checkpoints WHERE route_id=$1 AND active ORDER BY position",
            [data.route_id],
          );
          payload.route_snapshot = {
            ...r.rows[0],
            checkpoints: checkpoints.rows,
          };
        } else if (data.status === "completed")
          payload.actual_arrival = new Date();
      }
      const keys = Object.keys(payload);
      let row: Row;
      if (id) {
        payload.updated_at = new Date();
        const cols = Object.keys(payload);
        const out = await db.query(
          `UPDATE ${res.table} SET ${cols.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE id=$${cols.length + 1} RETURNING *`,
          [...cols.map((k) => payload[k]), id],
        );
        row = out.rows[0];
      } else {
        const out = await db.query(
          `INSERT INTO ${res.table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
          keys.map((k) => payload[k]),
        );
        row = out.rows[0];
      }
      if (key === "users") {
        const extras = profileKeys.filter((k) => k in input);
        if (extras.length) {
          await db.query(
            `INSERT INTO user_profiles(user_id,${extras.join(",")}) VALUES($1,${extras.map((_, i) => `$${i + 2}`).join(",")}) ON CONFLICT(user_id) DO UPDATE SET ${extras.map((k) => `${k}=EXCLUDED.${k}`).join(",")}`,
            [row.id, ...extras.map((k) => input[k])],
          );
        }
      }
      if (
        key === "trips" &&
        before &&
        before.status !== row.status &&
        (row.status === "in_transit" || before.status === "in_transit")
      ) {
        const starting = row.status === "in_transit";
        await db.query(
          "UPDATE units SET status=$2,updated_at=now() WHERE id=$1",
          [row.unit_id, starting ? "in_transit" : "available"],
        );
        await db.query(
          `UPDATE shipments s SET status=CASE WHEN $2 THEN 'in_transit' WHEN $3='completed' AND ts.final_leg THEN 'delivered' ELSE 'ready' END,updated_at=now() FROM trip_shipments ts WHERE s.id=ts.shipment_id AND ts.trip_id=$1 AND ts.active`,
          [row.id, starting, row.status],
        );
        await db.query(
          `UPDATE containers SET status=$2,updated_at=now() WHERE id IN (SELECT container_id FROM trip_shipments WHERE trip_id=$1 AND active)`,
          [row.id, starting ? "in_use" : "available"],
        );
        if (!starting)
          await db.query(
            "UPDATE assignments SET ends_at=GREATEST(starts_at,LEAST(coalesce(ends_at,now()),now())),updated_at=now() WHERE trip_id=$1 AND active",
            [row.id],
          );
      }
      const result = await this.get(key, row.id, actor, db);
      await audit(
        db,
        actor,
        key,
        row.id,
        id ? "update" : "create",
        before,
        result,
      );
      if (key === "incidents" && !before) {
        await db.query(
          `INSERT INTO notification_deliveries(rule_id,incident_id,status,detail) SELECT nr.id,$1,CASE WHEN nr.channel='dashboard' THEN 'available' ELSE 'not_configured' END,CASE WHEN nr.channel='dashboard' THEN 'Disponible en el panel de incidentes' ELSE 'El adaptador de envío externo todavía no está configurado' END FROM notification_rules nr JOIN users u ON u.id=nr.user_id WHERE nr.active AND u.active AND (nr.severity='info' OR nr.severity=$2 OR (nr.severity='warning' AND $2='critical'))`,
          [row.id, row.severity],
        );
      }
      return result;
    });
  }
  async archive(key: string, id: string, actor: Actor) {
    return this.transaction(async (db) => {
      const before = await this.get(key, id, actor, db, true);
      if (key === "assignments") {
        const running = await db.query("SELECT status FROM trips WHERE id=$1", [
          before.trip_id,
        ]);
        if (running.rows[0]?.status === "in_transit") {
          const remaining = await db.query(
            "SELECT id FROM assignments WHERE trip_id=$1 AND active AND id<>$2 AND starts_at<=now() AND (ends_at IS NULL OR ends_at>=now())",
            [before.trip_id, id],
          );
          if (!remaining.rows.length)
            throw new ManagementError(
              409,
              "El viaje en curso debe conservar al menos una persona asignada.",
            );
        }
      }
      if (key === "users")
        await this.validate(
          db,
          key,
          actor,
          { ...before, active: false },
          before,
        );
      if (key === "trips" && ["planned", "in_transit"].includes(before.status))
        throw new ManagementError(
          409,
          "Finaliza o cancela el viaje antes de archivarlo.",
        );
      if (key === "shipments" && before.status === "in_transit")
        throw new ManagementError(409, "El envío está en tránsito.");
      if (
        key === "incidents" &&
        !["resolved", "dismissed"].includes(before.status)
      )
        throw new ManagementError(
          409,
          "Resuelve el incidente antes de archivarlo.",
        );
      if (key === "trip-shipments") {
        const t = await db.query("SELECT status FROM trips WHERE id=$1", [
          before.trip_id,
        ]);
        if (t.rows[0]?.status !== "planned")
          throw new ManagementError(
            409,
            "El manifiesto de un viaje iniciado debe conservarse.",
          );
      }
      if (key === "units") {
        const t = await db.query(
          "SELECT id FROM trips WHERE unit_id=$1 AND active AND status IN ('planned','in_transit')",
          [id],
        );
        if (t.rows.length)
          throw new ManagementError(409, "La unidad tiene viajes pendientes.");
        await db.query("UPDATE units SET active_node_id=NULL WHERE id=$1", [
          id,
        ]);
      }
      if (key === "nodes") {
        const running = await db.query(
          "SELECT t.id FROM trips t JOIN nodes n ON n.unit_id=t.unit_id WHERE n.id=$1 AND t.status='in_transit' AND t.active",
          [id],
        );
        if (running.rows.length)
          throw new ManagementError(
            409,
            "No retires dispositivos durante un viaje en curso.",
          );
        await db.query(
          "UPDATE units SET active_node_id=NULL WHERE active_node_id=$1",
          [id],
        );
        await db.query("UPDATE nodes SET is_online=false WHERE id=$1", [id]);
      }
      const { rows } = await db.query(
        `UPDATE ${resources[key]!.table} SET active=false,updated_at=now() WHERE id=$1 RETURNING *`,
        [id],
      );
      await audit(db, actor, key, id, "archive", before, rows[0]);
    });
  }
  async options(key: string, actor: Actor) {
    if (key === "users") {
      const { rows } = await this.pool.query(
        `SELECT id,coalesce(nullif(trim(concat(first_name,' ',last_name)),''),email) label,role FROM users WHERE active ${["admin", "control_center", "auditor"].includes(actor.role) ? "" : "AND id=$1"} ORDER BY email`,
        ["admin", "control_center", "auditor"].includes(actor.role)
          ? []
          : [actor.id],
      );
      return rows;
    }
    if (key === "events") {
      const ids = await unitIds(this.pool, actor);
      const { rows } = await this.pool.query(
        `SELECT id,kind||' · '||to_char(ts,'YYYY-MM-DD HH24:MI') label,unit_id FROM events ${ids === null ? "" : "WHERE unit_id=ANY($1::uuid[])"} ORDER BY ts DESC LIMIT 200`,
        ids === null ? [] : [ids],
      );
      return rows;
    }
    const res = resources[key];
    if (!res) throw new ManagementError(404, "Catálogo no encontrado.");
    const s = await this.scope(this.pool, key, actor);
    const label =
      key === "units"
        ? "coalesce(r.label,r.unit_code)||' · '||r.unit_code"
        : key === "nodes"
          ? "coalesce(r.label,r.node_code)||' · '||r.node_code"
          : res.fields.some((f) => f.key === "name")
            ? "r.name"
            : "r.id::text";
    const { rows } = await this.pool.query(
      `SELECT r.id,${label} label ${["trips", "nodes"].includes(key) ? ",r.unit_id" : ""} FROM ${res.table} r WHERE r.active AND (${s.sql}) ORDER BY label LIMIT 2000`,
      s.values,
    );
    return rows;
  }
}
