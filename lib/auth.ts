import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { getStore } from "./store";
import { uid } from "./util";

export const COOKIE = "sut_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET || "sut-ste-desarrollo-cambia-esta-clave-en-produccion";
  return new TextEncoder().encode(s.padEnd(32, "0"));
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pw, hash);
  } catch {
    return false;
  }
}

export async function createSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySession(token);
  if (!userId) return null;
  const db = getStore();
  const u = await db.getUserById(userId);
  if (!u) return null;
  return {
    id: String(u.id),
    email: String(u.email),
    name: String(u.name || ""),
    role: String(u.role || "user"),
  };
}

export async function createUserAccount(email: string, name: string, password: string) {
  const db = getStore();
  const hash = await hashPassword(password);
  return db.createUser({ id: uid("u_"), email: email.trim().toLowerCase(), name: name.trim(), password_hash: hash, role: "admin" });
}
