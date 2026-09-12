import { NextResponse } from "next/server";
import { getSession } from "./auth";

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function requireUser(): Promise<{ user: ApiUser } | { error: NextResponse }> {
  const user = await getSession();
  if (!user) {
    return { error: NextResponse.json({ error: "Sesion no valida. Inicia sesion de nuevo." }, { status: 401 }) };
  }
  return { user };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(e: unknown) {
  console.error("[api]", e);
  return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
