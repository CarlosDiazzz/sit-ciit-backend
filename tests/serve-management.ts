import { registerNodeHistoryRoutes } from "../src/adapters/in/http/nodeHistoryRoutes.js";
// Servidor exclusivo de Playwright: usa un esquema temporal; nunca las tablas reales.
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { registerAccess } from "../src/adapters/in/http/management/access.js";
import { registerManagementRoutes } from "../src/adapters/in/http/management/routes.js";
import { registerAuthRoutes } from "../src/adapters/in/http/authRoutes.js";
import { registerNodeRoutes } from "../src/adapters/in/http/nodeRoutes.js";
import { registerUnitRoutes } from "../src/adapters/in/http/unitRoutes.js";
import { PgUserRepository } from "../src/adapters/out/postgres/PgUserRepository.js";
import { PgNodeCredentialRepository } from "../src/adapters/out/postgres/PgNodeCredentialRepository.js";
import { PgUnitRepository } from "../src/adapters/out/postgres/PgUnitRepository.js";
import { makeLogin } from "../src/application/login.js";
import { hashPassword } from "../src/domain/password.js";
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL requerida para pruebas de navegador.");
process.env.JWT_SECRET = "playwright-test-only-secret";
const schema = `test_browser_${randomUUID().replaceAll("-", "")}`;
const root = new Pool({ connectionString: process.env.DATABASE_URL });
await root.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema},public`,
});
const app = Fastify();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
}
process.on("SIGTERM", () => void close().then(() => process.exit(0)));
process.on("SIGINT", () => void close().then(() => process.exit(0)));
try {
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pool.query(
      readFileSync(`migrations/${file}`, "utf8")
        .replace("CREATE EXTENSION IF NOT EXISTS timescaledb;", "")
        .replace(/SELECT create_hypertable\([^;]+;/g, ""),
    );
  await pool.query(
    "INSERT INTO users(email,password_hash,role,first_name,last_name) VALUES($1,$2,$3,$4,$5)",
    [
      "admin@browser.invalid",
      await hashPassword("browser-test-password"),
      "admin",
      "Prueba",
      "Navegador",
    ],
  );
  await app.register(cors, { origin: "http://127.0.0.1:4311" });
  app.get("/health", () => ({ status: "ok" }));
  registerAccess(app, pool);
  registerManagementRoutes(app, pool);
  registerNodeHistoryRoutes(app, pool);
  registerAuthRoutes(app, makeLogin(new PgUserRepository(pool)), { send: async () => ({ sent: true }) });
  registerNodeRoutes(app, new PgNodeCredentialRepository(pool), pool);
  registerUnitRoutes(app, new PgUnitRepository(pool), pool);
  await app.listen({ host: "127.0.0.1", port: 4310 });
  console.log("Servidor aislado listo en 4310");
} catch (e) {
  await close();
  throw e;
}
