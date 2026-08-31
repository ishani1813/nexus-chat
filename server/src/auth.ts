import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import type { Db } from "./db";
import type { AuthUser } from "./types";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRY = "24h";
const SALT_ROUNDS = 10;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function register(db: Db, username: string, password: string): Promise<{ user: AuthUser; token: string }> {
  if (!USERNAME_RE.test(username)) {
    throw new AuthError("Username must be 3-20 characters: letters, numbers, underscore only");
  }
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters");
  }
  if (db.findUserByUsername(username)) {
    throw new AuthError("Username already taken");
  }

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  db.createUser({ id, username, passwordHash });

  const user: AuthUser = { id, username };
  return { user, token: signToken(user) };
}

export async function login(db: Db, username: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const row = db.findUserByUsername(username);
  if (!row) throw new AuthError("Invalid username or password");

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) throw new AuthError("Invalid username or password");

  const user: AuthUser = { id: row.id, username: row.username };
  return { user, token: signToken(user) };
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    return { id: decoded.id, username: decoded.username };
  } catch {
    return null;
  }
}
