import type { Pool } from "pg";

import {
  EmailAlreadyExistsError,
  type NewUser,
  type UserRecord,
  type UserRepository,
  type UserWithPasswordHash,
} from "../../../domain/ports/UserRepository.js";

interface UserRow {
  id: string;
  email: string;
  role: UserRecord["role"];
  created_at: Date;
}

interface UserRowWithHash extends UserRow {
  password_hash: string;
}

function toRecord(r: UserRow): UserRecord {
  return { id: r.id, email: r.email, role: r.role, createdAt: r.created_at };
}

/** Código de Postgres para violación de constraint UNIQUE. */
const UNIQUE_VIOLATION = "23505";

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(user: NewUser): Promise<UserRecord> {
    try {
      const { rows } = await this.pool.query<UserRow>(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)
         RETURNING id, email, role, created_at`,
        [user.email, user.passwordHash, user.role]
      );
      return toRecord(rows[0]!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new EmailAlreadyExistsError(user.email);
      throw err;
    }
  }

  async listAll(): Promise<UserRecord[]> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, email, role, created_at FROM users ORDER BY created_at`
    );
    return rows.map(toRecord);
  }

  async findByEmail(email: string): Promise<UserWithPasswordHash | null> {
    const { rows } = await this.pool.query<UserRowWithHash>(
      `SELECT id, email, role, created_at, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const row = rows[0];
    return row ? { ...toRecord(row), passwordHash: row.password_hash } : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, email, role, created_at FROM users WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async updateRole(id: string, role: UserRecord["role"]): Promise<boolean> {
    const { rowCount } = await this.pool.query(`UPDATE users SET role = $2 WHERE id = $1`, [id, role]);
    return (rowCount ?? 0) > 0;
  }

  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE users SET password_hash = $2 WHERE id = $1`,
      [id, passwordHash]
    );
    return (rowCount ?? 0) > 0;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === UNIQUE_VIOLATION;
}
