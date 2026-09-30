/** Rol de autorización del backend/dashboard — distinto de `IssuerRole`
 *  del contrato MQTT (`src/contract/contract.ts`), que describe quién
 *  puede emitir comandos a un nodo. `cliente` nunca emite comandos, así
 *  que no pertenece a ese tipo; vive solo aquí. */
export type UserRole = "control_center" | "operator" | "cliente";

export interface UserRecord {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
}

/** Solo para el login: incluye el hash, que nunca debe salir por la API
 *  de usuarios (listAll/create devuelven UserRecord, sin hash). */
export interface UserWithPasswordHash extends UserRecord {
  passwordHash: string;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  role: UserRole;
}

/** El adaptador la lanza cuando el email ya existe (constraint UNIQUE),
 *  para que la ruta responda 409 en vez de un 500 genérico. */
export class EmailAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`ya existe un usuario con el correo ${email}`);
    this.name = "EmailAlreadyExistsError";
  }
}

export interface UserRepository {
  create(user: NewUser): Promise<UserRecord>;
  listAll(): Promise<UserRecord[]>;
  findByEmail(email: string): Promise<UserWithPasswordHash | null>;
  findById(id: string): Promise<UserRecord | null>;
  updateRole(id: string, role: UserRole): Promise<boolean>;
  updatePassword(id: string, passwordHash: string): Promise<boolean>;
  /** false si el usuario no existe (404 en la ruta). */
  delete(id: string): Promise<boolean>;
}
