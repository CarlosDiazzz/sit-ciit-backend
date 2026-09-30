import { makeIngestHeartbeat } from "../src/application/ingestHeartbeat.js";
import { PgNodeStateRepository } from "../src/adapters/out/postgres/PgNodeStateRepository.js";
import { heartbeatMessageSchema } from "../src/adapters/in/mqtt/messageSchemas.js";
import { registerNodeHistoryRoutes } from "../src/adapters/in/http/nodeHistoryRoutes.js";
import { registerCustomerRoutes } from "../src/adapters/in/http/customerRoutes.js";
import { unitIds } from "../src/adapters/in/http/management/access.js";
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import Fastify from "fastify";
import { Pool } from "pg";
import { registerAccess } from "../src/adapters/in/http/management/access.js";
import { registerManagementRoutes } from "../src/adapters/in/http/management/routes.js";
import { signToken } from "../src/domain/jwt.js";
import { hashPassword } from "../src/domain/password.js";
import { PgCommandRepository } from "../src/adapters/out/postgres/PgCommandRepository.js";
import { makeIssueCommand } from "../src/application/issueCommand.js";
import { resources } from "../src/domain/management/resources.js";
import { registerUnitRoutes } from "../src/adapters/in/http/unitRoutes.js";
import { PgUnitRepository } from "../src/adapters/out/postgres/PgUnitRepository.js";
import { registerEventRoutes } from "../src/adapters/in/http/eventRoutes.js";
import { PgEventRepository } from "../src/adapters/out/postgres/PgEventRepository.js";
import { registerAuthRoutes } from "../src/adapters/in/http/authRoutes.js";
import { makeLogin } from "../src/application/login.js";
import { PgUserRepository } from "../src/adapters/out/postgres/PgUserRepository.js";
import { registerNodeRoutes } from "../src/adapters/in/http/nodeRoutes.js";
import { PgNodeCredentialRepository } from "../src/adapters/out/postgres/PgNodeCredentialRepository.js";

test("CRUDs logísticos, estados, aislamiento, cuentas y auditoría en un esquema PostgreSQL aislado", async (t) => {
  assert.ok(
    process.env.DATABASE_URL,
    "Se requiere DATABASE_URL para las pruebas de integración.",
  );
  process.env.JWT_SECRET = "test-only-management-secret";
  const schema = `test_management_${randomUUID().replaceAll("-", "")}`;
  const root = new Pool({ connectionString: process.env.DATABASE_URL });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
  });
  const app = Fastify();
  try {
    for (const file of readdirSync("migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(`migrations/${file}`, "utf8")
        .replace("CREATE EXTENSION IF NOT EXISTS timescaledb;", "")
        .replace(/SELECT create_hypertable\([^;]+;/g, "");
      await pool.query(sql);
    }
    const hash = await hashPassword("test-password-123");
    const actors: Record<string, { id: string; email: string; role: any }> = {};
    for (const role of [
      "admin",
      "control_center",
      "operator",
      "cliente",
      "technician",
      "auditor",
    ]) {
      const { rows } = await pool.query(
        "INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role",
        [`${role}@test.invalid`, hash, role],
      );
      actors[role] = rows[0];
    }
    registerAccess(app, pool);
    registerCustomerRoutes(app, pool, { send: async () => ({ sent: true }) });
    registerNodeHistoryRoutes(app, pool);
    const commands = new PgCommandRepository(pool);
    registerManagementRoutes(
      app,
      pool,
      makeIssueCommand(
        commands,
        { publish: async () => {} },
        { info: () => {} },
      ),
    );
    registerAuthRoutes(app, makeLogin(new PgUserRepository(pool)), { send: async () => ({ sent: true }) });
    registerUnitRoutes(app, new PgUnitRepository(pool), pool);
    registerEventRoutes(app, new PgEventRepository(pool), pool);
    registerNodeRoutes(app, new PgNodeCredentialRepository(pool), pool);
    const req = (
      method: string,
      path: string,
      body?: unknown,
      role = "admin",
    ) =>
      app.inject({
        method: method as any,
        url: path,
        payload: body as any,
        headers: { authorization: `Bearer ${signToken(actors[role])}` },
      });
    const create = async (key: string, body: unknown) => {
      const r = await req("POST", `/management/${key}`, body);
      assert.equal(r.statusCode, 201, `${key}: ${r.body}`);
      return r.json();
    };
    const patch = async (key: string, id: string, body: unknown) => {
      const r = await req("PATCH", `/management/${key}/${id}`, body);
      assert.equal(r.statusCode, 200, `${key}: ${r.body}`);
      return r.json();
    };
    const now = new Date(Date.now() - 3600000).toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    await t.test("autenticación, validación estricta y unicidad", async () => {
      assert.equal((await app.inject("/management/resources")).statusCode, 401);
      assert.equal(
        (
          await req("POST", "/management/companies", {
            code: "x",
            name: "X",
            unexpected: "x",
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await req("POST", "/management/locations", {
            code: "x",
            name: "X",
            location_type: "port",
            latitude: 100,
            longitude: 0,
          })
        ).statusCode,
        400,
      );
    });
    const company = await create("companies", {
      code: "co",
      name: "Empresa de prueba",
    });
    const foreignCompany = await create("companies", {
      code: "other",
      name: "Otra empresa",
    });
    await pool.query("UPDATE users SET company_id=$1 WHERE id=$2", [
      company.id,
      actors.cliente.id,
    ]);
    const profile = await create("monitoring-profiles", {
      code: "profile",
      name: "Perfil",
      sampling_ms: 1000,
      impact_threshold_g: 2.5,
    });
    const cargo = await create("cargo-types", {
      code: "cargo",
      name: "Carga",
      monitoring_profile_id: profile.id,
      weather_category: "agricola",
    });
    const origin = await create("locations", {
      code: "a",
      name: "Origen",
      location_type: "port",
      latitude: 16,
      longitude: -95,
    });
    const destination = await create("locations", {
      code: "b",
      name: "Destino",
      location_type: "terminal",
      latitude: 18,
      longitude: -94,
    });
    const route = await create("routes", {
      code: "route",
      name: "Ruta",
      origin_id: origin.id,
      destination_id: destination.id,
      distance_km: 300,
    });
    const checkpoint = await create("route-checkpoints", {
      route_id: route.id,
      location_id: origin.id,
      position: 1,
    });
    const unit = await create("units", {
      unit_code: "unit-test",
      label: "Unidad",
      transport_type: "vagon",
      status: "available",
      capacity_kg: 1000,
      company_id: company.id,
    });
    const otherUnit = await create("units", {
      unit_code: "other-unit",
      transport_type: "camion",
      status: "available",
    });
    const nodeResponse = await req("POST", "/nodes", {
      nodeCode: "test-node",
      unitCode: "unit-test",
      role: "primary",
    });
    assert.equal(nodeResponse.statusCode, 201, nodeResponse.body);
    const node = nodeResponse.json();
    assert.ok(node.secret);
    const container = await create("containers", {
      code: "container",
      name: "Contenedor",
      container_type: "standard",
      capacity_kg: 500,
      status: "available",
      company_id: company.id,
    });
    const shipment = await create("shipments", {
      name: "Envío",
      company_id: company.id,
      cargo_type_id: cargo.id,
      origin_id: origin.id,
      destination_id: destination.id,
      weight_kg: 100,
      status: "ready",
    });
    const foreignShipment = await create("shipments", {
      name: "Ajeno",
      company_id: foreignCompany.id,
      cargo_type_id: cargo.id,
      origin_id: origin.id,
      destination_id: destination.id,
      weight_kg: 100,
      status: "draft",
    });
    const trip = await create("trips", {
      code: "trip",
      name: "Viaje",
      route_id: route.id,
      unit_id: unit.id,
      planned_departure: now,
      planned_arrival: future,
      status: "planned",
    });
    const manifest = await create("trip-shipments", {
      trip_id: trip.id,
      shipment_id: shipment.id,
      container_id: container.id,
    });
    const assignment = await create("assignments", {
      user_id: actors.operator.id,
      trip_id: trip.id,
      function: "driver",
      starts_at: now,
    });
    const notification = await create("notification-rules", {
      code: "notify",
      name: "Avisos",
      user_id: actors.admin.id,
      severity: "warning",
      channel: "dashboard",
    });
    const incident = await create("incidents", {
      code: "incident",
      name: "Revisión",
      unit_id: unit.id,
      trip_id: trip.id,
      assigned_to: actors.operator.id,
      severity: "warning",
      description: "Fixture de prueba aislada",
      status: "open",
    });
    const maintenance = await create("maintenance", {
      code: "maintenance",
      name: "Revisión técnica",
      node_id: node.id,
      technician_id: actors.technician.id,
      scheduled_at: future,
      description: "Revisión",
      status: "scheduled",
    });
    const extraUser = await create("users", {
      email: "new@test.invalid",
      password: "new-password-123",
      role: "operator",
      first_name: "Prueba",
      last_name: "Usuario",
      field_function: "driver",
      license_number: "LIC-TEST",
    });
    const records: Record<string, any> = {
      companies: company,
      users: extraUser,
      units: unit,
      nodes: { ...node, id: node.id },
      containers: container,
      "monitoring-profiles": profile,
      "cargo-types": cargo,
      locations: origin,
      routes: route,
      "route-checkpoints": checkpoint,
      shipments: shipment,
      trips: trip,
      "trip-shipments": manifest,
      assignments: assignment,
      incidents: incident,
      "notification-rules": notification,
      maintenance,
    };
    await t.test(
      "lista, detalle y actualización para todos los recursos",
      async () => {
        for (const [key, record] of Object.entries(records)) {
          const list = await req("GET", `/management/${key}`);
          assert.equal(list.statusCode, 200, list.body);
          assert.ok(
            list.json().items.some((r: any) => r.id === record.id),
            key,
          );
          assert.equal(
            (await req("GET", `/management/${key}/${record.id}`)).statusCode,
            200,
            key,
          );
          const field = resources[key].fields.find(
            (f) =>
              ["text", "textarea"].includes(f.type) &&
              !["code", "unit_code"].includes(f.key),
          );
          if (field)
            await patch(key, record.id, { [field.key]: "Actualizado" });
        }
        assert.equal(
          (
            await req("POST", "/management/companies", {
              code: "co",
              name: "Duplicado",
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await req("PATCH", `/management/units/${unit.id}`, {
              unit_code: null,
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await req("PATCH", `/management/trips/${trip.id}`, {
              status: "completed",
            })
          ).statusCode,
          409,
        );
      },
    );
    await t.test(
      "perfiles emiten configuración compatible y conservan confirmaciones",
      async () => {
        const response = await req(
          "POST",
          `/management/monitoring-profiles/${profile.id}/apply`,
          { node_id: node.id },
        );
        assert.equal(response.statusCode, 201, response.body);
        assert.equal(response.json().commands.length, 2);
        const command = response.json().commands[0];
        await commands.applyAck({
          cmdId: command.cmdId,
          msgId: randomUUID(),
          status: "executed",
          occurredAt: new Date(),
        });
        const applications = (
          await req(
            "GET",
            `/management/monitoring-profiles/${profile.id}/applications`,
          )
        ).json();
        assert.equal(applications.length, 1);
        assert.ok(
          applications[0].commands.some((c: any) => c.status === "executed"),
        );
        assert.equal(
          (
            await req(
              "POST",
              `/management/monitoring-profiles/${profile.id}/apply`,
              { node_id: node.id },
              "operator",
            )
          ).statusCode,
          403,
        );
      },
    );
    await t.test(
      "roles, empresa y asignaciones restringen las consultas y escrituras",
      async () => {
        const list = (
          await req("GET", "/management/shipments", undefined, "cliente")
        ).json();
        assert.ok(list.items.some((r: any) => r.id === shipment.id));
        assert.ok(!list.items.some((r: any) => r.id === foreignShipment.id));
        assert.equal(
          (
            await req(
              "GET",
              `/management/shipments/${foreignShipment.id}`,
              undefined,
              "cliente",
            )
          ).statusCode,
          404,
        );
        assert.equal(
          (
            await req(
              "POST",
              "/management/companies",
              { code: "bad", name: "bad" },
              "cliente",
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await req(
              "POST",
              "/management/companies",
              { code: "bad", name: "bad" },
              "auditor",
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (await req("GET", "/units", undefined, "cliente")).statusCode,
          403,
        );
        const units = (
          await req("GET", "/units", undefined, "operator")
        ).json();
        assert.equal(units.length, 1);
        assert.equal(units[0].id, unit.id);
        assert.equal(
          (
            await req(
              "PATCH",
              `/units/${otherUnit.id}/cargo-category`,
              { category: "agricola" },
              "operator",
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await req(
              "PATCH",
              `/management/users/${extraUser.id}`,
              { role: "admin" },
              "control_center",
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await req("PATCH", `/management/users/${actors.admin.id}`, {
              role: "operator",
            })
          ).statusCode,
          400,
        );
      },
    );
    await t.test("conectividad: recuperación real, GPS posterior, límites y permisos", async () => {
      const eventRepo = new PgEventRepository(pool);
      const ingest = makeIngestHeartbeat(new PgNodeStateRepository(pool), eventRepo,
        {nodeStatus:()=>{},activeNode:()=>{},event:()=>{},commandUpdate:()=>{}}, {info:()=>{}});
      const heartbeat = heartbeatMessageSchema.parse({contractVersion:"1.2.0",msgId:randomUUID(),
        nodeId:"test-node",unitId:"unit-test",role:"primary",nodeSecret:node.secret,
        seq:0,ts:Date.now(),type:"heartbeat",pendingOutbox:0,samplingMs:1000,capabilities:["gps"],mode:"normal"});
      await pool.query("UPDATE nodes SET is_online=false,last_heartbeat_at=NULL WHERE id=$1",[node.id]);
      await ingest(heartbeat);
      assert.equal((await pool.query("SELECT id FROM events WHERE node_id=$1 AND kind='signal_recovered'",[node.id])).rowCount,0);
      await pool.query("UPDATE nodes SET is_online=false WHERE id=$1",[node.id]);
      await ingest({...heartbeat,msgId:randomUUID()});
      await ingest({...heartbeat,msgId:randomUUID()});
      const recovered = (await pool.query("SELECT * FROM events WHERE node_id=$1 AND kind='signal_recovered'",[node.id])).rows;
      assert.equal(recovered.length,1);
      const ts = recovered[0].ts.getTime();
      await pool.query("INSERT INTO telemetry(msg_id,node_id,seq,ts,gps_lat,gps_lon) VALUES($1,$2,1,$3,44,44),($4,$2,2,$5,0,0)",
        [randomUUID(),node.id,new Date(ts-1000),randomUUID(),new Date(ts+1000)]);
      const params = new URLSearchParams({nodeId:node.id,from:new Date(ts-60000).toISOString(),to:new Date(ts+60000).toISOString(),limit:"200"});
      const path = `/node-history/connectivity?${params}`;
      const result = await req("GET",path,undefined,"operator");
      assert.equal(result.statusCode,200,result.body);
      assert.equal(result.json().items[0].gpsLat,0);
      assert.equal(result.json().items[0].gpsLon,0);
      assert.equal(new Date(result.json().items[0].positionTs).getTime(),ts+1000);
      await pool.query("DELETE FROM telemetry WHERE node_id=$1 AND ts>$2",[node.id,new Date(ts)]);
      assert.equal((await req("GET",path)).json().items[0].gpsLat,null);
      assert.equal((await req("GET",path,undefined,"cliente")).statusCode,403);
      const foreignNode = (await req("POST","/nodes",{nodeCode:"connectivity-foreign",unitCode:"other-unit",role:"backup"})).json();
      params.set("nodeId",foreignNode.id);
      assert.equal((await req("GET",`/node-history/connectivity?${params}`,undefined,"operator")).statusCode,403);
      params.set("nodeId",node.id);params.set("from",new Date(ts+120000).toISOString());
      assert.equal((await req("GET",`/node-history/connectivity?${params}`)).statusCode,400);
      await pool.query("DELETE FROM telemetry WHERE node_id=$1",[node.id]);
      await pool.query("DELETE FROM events WHERE node_id=$1 AND kind='signal_recovered'",[node.id]);
    });
    await t.test(
      "historial por nodo: filtros, permisos, paginación estable y nodos archivados",
      async () => {
        const timestamp = new Date(Date.now() - 60000).toISOString();
        const earlier = new Date(Date.now() - 120000).toISOString();
        const until = new Date().toISOString();
        for (let seq = 0; seq < 3; seq++)
          await pool.query(
            "INSERT INTO telemetry(msg_id,node_id,seq,ts,accel_x,gps_speed_ms) VALUES($1,$2,$3,$4,$5,$6)",
            [
              randomUUID(),
              node.id,
              seq,
              timestamp,
              seq === 0 ? 0 : null,
              seq === 0 ? 0 : 2,
            ],
          );
        const params = new URLSearchParams({
          nodeId: node.id,
          from: earlier,
          to: until,
          limit: "2",
        });
        const first = await req("GET", `/node-history?${params}`);
        assert.equal(first.statusCode, 200, first.body);
        assert.equal(first.json().items.length, 2);
        assert.equal(first.json().hasMore, true);
        params.set("cursor", first.json().nextCursor);
        const second = await req("GET", `/node-history?${params}`);
        assert.equal(second.statusCode, 200, second.body);
        assert.equal(second.json().items.length, 1);
        assert.equal(second.json().hasMore, false);
        const combined = [...first.json().items, ...second.json().items];
        assert.equal(new Set(combined.map((r) => r.id)).size, 3);
        assert.ok(combined.every((r) => r.nodeCode === "test-node"));
        assert.ok(combined.some((r) => r.accelX === 0 && r.gpsSpeedMs === 0));
        assert.ok(combined.some((r) => r.accelX === null));
        params.delete("cursor");
        params.set("to", earlier);
        params.set("from", until);
        assert.equal(
          (await req("GET", `/node-history?${params}`)).statusCode,
          400,
        );
        params.set("from", earlier);
        params.set("to", until);
        assert.equal(
          (await req("GET", `/node-history?${params}`, undefined, "cliente"))
            .statusCode,
          403,
        );
        assert.equal(
          (await req("GET", `/node-history?${params}`, undefined, "operator"))
            .statusCode,
          200,
        );
        const stranger = await req("POST", "/nodes", {
          nodeCode: "other-node",
          unitCode: "other-unit",
          role: "primary",
        });
        assert.equal(stranger.statusCode, 201);
        params.set("nodeId", stranger.json().id);
        assert.equal(
          (await req("GET", `/node-history?${params}`, undefined, "operator"))
            .statusCode,
          403,
        );
        assert.ok(
          !(await req("GET", "/node-history/nodes", undefined, "operator"))
            .json()
            .some((n: any) => n.nodeCode === "other-node"),
        );
        await pool.query("UPDATE nodes SET active=false WHERE id=$1", [
          node.id,
        ]);
        params.set("nodeId", node.id);
        assert.equal(
          (await req("GET", `/node-history?${params}`)).json().items.length,
          2,
        );
        await pool.query("UPDATE nodes SET active=true WHERE id=$1", [node.id]);
        await pool.query("DELETE FROM telemetry WHERE node_id=$1", [node.id]);
      },
    );
    await t.test(
      "inicio y fin de viaje actualizan manifiesto, recursos y snapshot",
      async () => {
        const started = await patch("trips", trip.id, { status: "in_transit" });
        assert.ok(started.actual_departure);
        {
          assert.match(shipment.code, /^SITCIIT-\d{4}-\d{6,}$/);
          assert.notEqual(shipment.code, foreignShipment.code);
          const generated=await Promise.all(Array.from({length:4},()=>create("shipments",{name:"Concurrencia de folios",company_id:company.id,cargo_type_id:cargo.id,origin_id:origin.id,destination_id:destination.id,weight_kg:1,status:"draft"})));
          assert.equal(new Set(generated.map(s=>s.code)).size,4);
          assert.equal((await req("PATCH", `/management/shipments/${shipment.id}`, {code:"SITCIIT-2026-999999"})).statusCode,400);
          const manual={name:"Manual",code:"SITCIIT-2026-999999",company_id:company.id,cargo_type_id:cargo.id,origin_id:origin.id,destination_id:destination.id,weight_kg:1,status:"draft"};
          assert.equal((await req("POST","/management/shipments",manual)).statusCode,400);
          const foreign=await create("users",{email:"foreign-client@test.invalid",password:"test-password-123",first_name:"Cliente",last_name:"Ajeno",role:"cliente",company_id:foreignCompany.id});
          actors.foreignCustomer={id:foreign.id,email:foreign.email,role:"cliente"};
          const login=await app.inject({method:"POST",url:"/auth/login",payload:{email:actors.cliente.email,password:"test-password-123"}});
          assert.equal(login.statusCode,200);
          const session=await app.inject({url:"/customer/session",headers:{authorization:`Bearer ${login.json().token}`}});
          assert.deepEqual(session.json(),{role:"cliente",companyName:(await pool.query("SELECT name FROM companies WHERE id=$1",[company.id])).rows[0].name});
          assert.equal((await app.inject({method:"POST",url:"/customer/tracking",payload:{reference:shipment.code}})).statusCode,401);
          const denied=await req("POST","/customer/tracking",{reference:shipment.code},"foreignCustomer");
          const missing=await req("POST","/customer/tracking",{reference:"SITCIIT-2026-999999"},"foreignCustomer");
          assert.equal(denied.statusCode,404);assert.equal(denied.body,missing.body);
          assert.deepEqual(await unitIds(pool,{...actors.cliente,company_id:company.id}),[unit.id]);
          assert.deepEqual(await unitIds(pool,{...actors.foreignCustomer,company_id:foreignCompany.id}),[]);
          assert.deepEqual(await unitIds(pool,{...actors.cliente,company_id:null}),[]);
          assert.equal((await req("GET","/units",undefined,"cliente")).statusCode,403);
          assert.equal((await req("POST","/customer/tracking",{reference:foreignShipment.code},"cliente")).statusCode,404);
          assert.equal((await req("POST","/customer/tracking",{reference:shipment.code},"cliente")).json().location,null);
          // Fixtures exclusivamente dentro del esquema PostgreSQL aislado.
          await pool.query(`INSERT INTO telemetry(msg_id,node_id,seq,ts,gps_lat,gps_lon,gps_accuracy_m) VALUES
            ($1,$2,1,$3::timestamptz-interval '1 day',50,50,10),($4,$2,2,clock_timestamp(),17.123,-95.234,12),
            ($5,$2,3,clock_timestamp()+interval '1 day',60,60,10)`,[randomUUID(),node.id,started.actual_departure,randomUUID(),randomUUID()]);
          const result=await req("POST","/customer/tracking",{reference:shipment.code},"cliente");
          assert.equal(result.statusCode,200);assert.equal(result.json().location.lat,17.123);assert.equal(result.json().eta,null);
          for(const value of [node.id,node.node_code,unit.id,actors.operator.email])assert.ok(!result.body.includes(value));
          const eventId=randomUUID();
          await pool.query("INSERT INTO events(id,unit_id,node_id,kind,severity,value,ts) VALUES($1,$2,$3,'impact','critical',42,clock_timestamp())",[eventId,unit.id,node.id]);
          const withEvent=(await req("POST","/customer/tracking",{reference:shipment.code},"cliente")).json();
          assert.equal(withEvent.events[0].title,"Movimiento registrado");
          assert.deepEqual(Object.keys(withEvent.events[0]).sort(),["at","detail","id","title"]);
          assert.ok(!JSON.stringify(withEvent).includes(eventId));
          await pool.query("DELETE FROM events WHERE id=$1",[eventId]);
          await pool.query("UPDATE companies SET active=false WHERE id=$1",[company.id]);
          assert.equal((await req("POST","/customer/tracking",{reference:shipment.code},"cliente")).statusCode,403);
          assert.deepEqual(await unitIds(pool,{...actors.cliente,company_id:company.id}),[]);
          await pool.query("UPDATE companies SET active=true WHERE id=$1",[company.id]);
          await pool.query("DELETE FROM telemetry WHERE node_id=$1",[node.id]);
        }
        assert.ok(started.route_snapshot);
        assert.equal(started.route_snapshot.version, 2);
        assert.equal(
          (
            await req("PATCH", `/management/trips/${trip.id}`, {
              unit_id: otherUnit.id,
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (await req("DELETE", `/management/trip-shipments/${manifest.id}`))
            .statusCode,
          409,
        );
        const u = (await req("GET", `/management/units/${unit.id}`)).json();
        assert.equal(u.status, "in_transit");
        await patch("routes", route.id, { description: "Nueva versión" });
        const finished = await patch("trips", trip.id, {
          status: "completed",
          planned_departure: now,
          planned_arrival: future,
          unit_id: unit.id,
          route_id: route.id,
        });
        assert.ok(finished.actual_arrival);
        assert.deepEqual(await unitIds(pool,{...actors.cliente,company_id:company.id}),[]);
        await pool.query(`INSERT INTO telemetry(msg_id,node_id,seq,ts,gps_lat,gps_lon) VALUES($1,$2,1,$3::timestamptz+interval '1 second',51,51)`,[randomUUID(),node.id,finished.actual_arrival]);
        assert.equal((await req("POST","/customer/tracking",{reference:shipment.code},"cliente")).json().location,null);
        await pool.query("DELETE FROM telemetry WHERE node_id=$1",[node.id]);
        assert.equal(finished.route_snapshot.version, 2);
        assert.equal(
          (await req("GET", `/management/shipments/${shipment.id}`)).json()
            .status,
          "delivered",
        );
        assert.equal(
          (await req("GET", `/management/containers/${container.id}`)).json()
            .status,
          "available",
        );
        const report = await req(
          "GET",
          `/management/reports/trips/${trip.id}`,
          undefined,
          "cliente",
        );
        assert.equal(report.statusCode, 200);
        assert.equal(report.json().telemetry.samples, 0);
        assert.equal(report.json().telemetry.average_speed_kmh, null);
      },
    );
    await t.test(
      "comentarios, resolución, notificaciones y mantenimiento",
      async () => {
        const comment = await req(
          "POST",
          `/management/incidents/${incident.id}/notes`,
          { body: "Revisado", evidence_url: "https://example.com/evidence" },
        );
        assert.equal(comment.statusCode, 201, comment.body);
        assert.equal(
          (
            await req("PATCH", `/management/incidents/${incident.id}`, {
              status: "resolved",
            })
          ).statusCode,
          400,
        );
        await patch("incidents", incident.id, {
          status: "resolved",
          resolution: "Inspección terminada",
        });
        assert.equal(
          (
            await req("POST", `/management/incidents/${incident.id}/notes`, {
              body: "Nuevo comentario",
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await req("GET", `/management/incidents/${incident.id}/notes`)
          ).json().length,
          1,
        );
        assert.equal(
          (await req("GET", "/management/notification-deliveries")).json()
            .length,
          1,
        );
        assert.equal(
          (
            await req("PATCH", `/management/maintenance/${maintenance.id}`, {
              status: "completed",
            })
          ).statusCode,
          400,
        );
        await patch("maintenance", maintenance.id, {
          status: "completed",
          result: "Verificado",
        });
      },
    );
    await t.test(
      "envíos multimodales conservan el envío listo entre tramos",
      async () => {
        const s = await create("shipments", {
          name: "Multimodal",
          company_id: company.id,
          cargo_type_id: cargo.id,
          origin_id: origin.id,
          destination_id: destination.id,
          weight_kg: 50,
          status: "ready",
        });
        for (const final_leg of [false, true]) {
          const leg = await create("trips", {
            code: final_leg ? "final-leg" : "first-leg",
            name: "Tramo",
            route_id: route.id,
            unit_id: unit.id,
            planned_departure: now,
            planned_arrival: future,
            status: "planned",
          });
          await create("trip-shipments", {
            trip_id: leg.id,
            shipment_id: s.id,
            final_leg,
          });
          await create("assignments", {
            user_id: actors.operator.id,
            trip_id: leg.id,
            function: "driver",
            starts_at: now,
          });
          await patch("trips", leg.id, { status: "in_transit" });
          await patch("trips", leg.id, { status: "completed" });
          assert.equal(
            (await req("GET", `/management/shipments/${s.id}`)).json().status,
            final_leg ? "delivered" : "ready",
          );
        }
      },
    );
    await t.test(
      "bajas preservan datos, revocan acceso y no filtran secretos",
      async () => {
        const archive = await req(
          "DELETE",
          `/management/users/${extraUser.id}`,
        );
        assert.equal(archive.statusCode, 204, archive.body);
        const raw = await pool.query(
          "SELECT active,password_hash FROM users WHERE id=$1",
          [extraUser.id],
        );
        assert.equal(raw.rows[0].active, false);
        assert.ok(raw.rows[0].password_hash);
        const login = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: extraUser.email, password: "new-password-123" },
        });
        assert.equal(login.statusCode, 401);
        const audit = await req("GET", "/management/audit?limit=100");
        assert.equal(audit.statusCode, 200);
        assert.ok(audit.json().total > 20);
        assert.ok(!audit.body.includes("scrypt$"));
        assert.ok(!audit.body.includes(node.secret));
        const userList = await req("GET", "/management/users?archived=true");
        assert.ok(!userList.body.includes("password_hash"));
        const oldToken = signToken({
          id: extraUser.id,
          email: extraUser.email,
          role: "operator",
        });
        assert.equal(
          (
            await app.inject({
              url: "/management/resources",
              headers: { authorization: `Bearer ${oldToken}` },
            })
          ).statusCode,
          401,
        );
        for (const key of [
          "incidents",
          "maintenance",
          "notification-rules",
          "assignments",
          "trips",
          "shipments",
          "route-checkpoints",
          "routes",
          "containers",
          "cargo-types",
          "monitoring-profiles",
          "locations",
          "nodes",
          "units",
          "companies",
        ]) {
          const r = await req(
            "DELETE",
            `/management/${key}/${records[key].id}`,
          );
          assert.equal(r.statusCode, 204, `${key}: ${r.body}`);
          assert.equal(
            (await req("GET", `/management/${key}/${records[key].id}`)).json()
              .active,
            false,
            key,
          );
        }
        assert.equal(
          (
            await pool.query("SELECT count(*)::int n FROM nodes WHERE id=$1", [
              node.id,
            ])
          ).rows[0].n,
          1,
        );
      },
    );
  } finally {
    await app.close();
    await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  }
});
