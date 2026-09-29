// Runner de migraciones minimalista: aplica migrations/*.sql en orden,
// registrando cada archivo aplicado en la tabla schema_migrations.
// Uso: npm run migrate

import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "..", "migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (revisa tu .env)");
  }

  const client = new Client({ connectionString });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows } = await client.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations"
  );
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`omitida (ya aplicada): ${file}`);
      continue;
    }

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`aplicando: ${file}`);

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("  OK");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
