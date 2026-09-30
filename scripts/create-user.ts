// Alta de usuarios del centro de control.
//
// Uso:
//   npm run create-user -- <email> <control_center|operator>
//
// Pide la contraseña de forma interactiva para no dejarla en el
// historial del shell. Si el correo ya existe, actualiza rol y
// contraseña en vez de fallar.

import "dotenv/config";
import { createInterface } from "node:readline";
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Client } from "pg";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const ROLES = ["control_center", "operator"] as const;
type Role = (typeof ROLES)[number];

/** scrypt con sal aleatoria por usuario. Formato: scrypt$<sal>$<hash>,
 *  ambos en base64, para poder cambiar de algoritmo más adelante sin
 *  romper los registros existentes. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const key = await scrypt(plain, Buffer.from(saltB64, "base64"), 64);
  const expected = Buffer.from(keyB64, "base64");
  // Comparación en tiempo constante: evita filtrar el hash por el tiempo
  // que tarda en fallar.
  return key.length === expected.length && timingSafeEqual(key, expected);
}

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
    console.error("Uso: npm run create-user -- <email> <control_center|operator>");
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
