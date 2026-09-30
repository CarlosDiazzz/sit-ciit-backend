import { signToken } from "../domain/jwt.js";
import { verifyPassword } from "../domain/password.js";
import type {
  UserRecord,
  UserRepository,
} from "../domain/ports/UserRepository.js";

export interface LoginResult {
  token: string;
  user: UserRecord;
}

export type Login = (
  email: string,
  password: string,
) => Promise<LoginResult | null>;

/** null en credenciales inválidas (email inexistente O password
 *  incorrecta) — nunca se distingue cuál de las dos falló, para no darle
 *  a un atacante pistas sobre qué correos existen. */
export function makeLogin(users: UserRepository): Login {
  return async function login(email, password) {
    const user = await users.findByEmail(email);
    if (!user || user.active === false) return null;

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return null;

    const { passwordHash: _passwordHash, ...record } = user;
    const token = signToken({
      id: record.id,
      email: record.email,
      role: record.role,
    });
    return { token, user: record };
  };
}
