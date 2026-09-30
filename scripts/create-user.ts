// Alta de usuarios. Sigue siendo el único camino para crear el primer
// control_center (el CRUD vía HTTP requiere ya ser control_center para
// usarlo — bootstrap por CLI, no por un endpoint sin proteger).
//
// Uso:
//   npm run create-user -- <email> <control_center|operator|cliente>
//
// Pide la contraseña de forma interactiva para no dejarla en el
// historial del shell. Si el correo ya existe, actualiza rol y
// contraseña en vez de fallar.

import "dotenv/config";
import { createInterface } from "node:readline";
import { Client } from "pg";

import { hashPassword } from "../src/domain/password.js";

const ROLES = ["control_center", "operator", "cliente"] as const;
type Role = (typeof ROLES)[number];

function askPassword(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [email, role] = process.argv.slice(2);

  if (!email || !role) {
    console.error("Uso: npm run create-user -- <email> <control_center|operator|cliente>");
    process.exit(1);
  }
  if (!ROLES.includes(role as Role)) {
    console.error(`Rol inválido: ${role}. Debe ser uno de: ${ROLES.join(", ")}`);
    process.exit(1);
  }

  const password = process.env.USER_PASSWORD ?? (await askPassword(`Contraseña para ${email}: `));
  if (password.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está definida (revisa tu .env)");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
       RETURNING id`,
      [email, passwordHash, role]
    );
    console.log(`Usuario '${email}' (${role}) creado/actualizado. id=${rows[0]!.id}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
