import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { clearSessionCookie, createSession, hashPassword, setSessionCookie, verifyPassword } from "@/lib/auth";
import { readJson, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getStore();
    const count = await db.countUsers();
    return NextResponse.json({ needsSetup: count === 0, backend: db.kind });
  } catch (e) {
    return serverError(e);
  }
}

/** Inicio de sesion. Si no existe ninguna cuenta, la primera peticion la crea. */
export async function POST(req: Request) {
  try {
    const db = getStore();
    const body = await readJson<{ email?: string; password?: string; name?: string }>(req);
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!email || !password) {
      return NextResponse.json({ error: "Correo y contrasena son obligatorios." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "La contrasena debe tener al menos 6 caracteres." }, { status: 400 });
    }

    const existing = await db.getUserByEmail(email);
    const total = await db.countUsers();

    if (!existing) {
      if (total > 0) {
        return NextResponse.json({ error: "Credenciales incorrectas." }, { status: 401 });
      }
      // primer arranque: crea la cuenta inicial
      const user = await db.createUser({
        email,
        name: (body.name || "").trim() || email.split("@")[0],
        password_hash: await hashPassword(password),
        role: "admin",
      });
      await setSessionCookie(await createSession(String(user.id)));
      return NextResponse.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        backend: db.kind,
        created: true,
      });
    }

    const ok = await verifyPassword(password, String(existing.password_hash));
    if (!ok) {
      return NextResponse.json({ error: "Credenciales incorrectas." }, { status: 401 });
    }
    await setSessionCookie(await createSession(String(existing.id)));
    return NextResponse.json({
      user: { id: existing.id, email: existing.email, name: existing.name, role: existing.role },
      backend: db.kind,
      created: false,
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE() {
  try {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
