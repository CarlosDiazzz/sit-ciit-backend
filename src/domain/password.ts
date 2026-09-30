import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

/** scrypt con sal aleatoria por usuario. Formato: scrypt$<sal>$<hash>,
 *  ambos en base64, para poder cambiar de algoritmo más adelante sin
 *  romper los registros existentes. Compartido entre scripts/create-user.ts
 *  y las rutas HTTP de auth/usuarios — una sola implementación. */
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
