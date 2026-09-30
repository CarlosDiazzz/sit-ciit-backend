import jwt from "jsonwebtoken";

import type { UserRole } from "./ports/UserRepository.js";

export interface TokenPayload {
  id: string;
  email: string;
  role: UserRole;
}

/** Un turno de control, no una sesión bancaria: sin refresh token, se
 *  vuelve a iniciar sesión si expira. */
const EXPIRES_IN = "12h";

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("falta la variable de entorno JWT_SECRET");
  return value;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: EXPIRES_IN });
}

/** null si el token es inválido o expiró — nunca lanza, para que el
 *  guard de rutas solo tenga que revisar null. */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret());
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "id" in decoded &&
      "email" in decoded &&
      "role" in decoded
    ) {
      return decoded as unknown as TokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}
