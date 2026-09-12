import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { badRequest, readJson, requireUser, serverError } from "@/lib/api-helpers";
import { DEFAULT_PARAMS, PARAM_KINDS } from "@/lib/schema-defs";
import { slugify, uid } from "@/lib/util";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

/**
 * Si el usuario todavía no tiene catálogos (primer arranque con la base vacía),
 * se siembran los valores por defecto: tipos de documento, carpetas y áreas.
 */
async function listWithSeed(ownerId: string): Promise<Row[]> {
  const db = getStore();
  const existing = await db.listParams(ownerId);
  if (existing.length) return existing;
  await db.upsertParams(
    DEFAULT_PARAMS.map((p) => ({ ...p, id: uid("p_"), owner_id: ownerId, archived: false })),
  );
  return db.listParams(ownerId);
}

/** Catálogos + ajustes del usuario. */
export async function GET() {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const db = getStore();
    const [params, settings] = await Promise.all([listWithSeed(r.user.id), db.getSettings(r.user.id)]);
    return NextResponse.json({
      params,
      settings: settings.data || {},
      backend: db.kind,
      serverTime: Date.now(),
    });
  } catch (e) {
    return serverError(e);
  }
}

/** Alta y edición de un parámetro. Tambien elimina cuando llega `deleteId`. */
export async function POST(req: Request) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const db = getStore();
    const body = await readJson<Row>(req);

    if (body.deleteId) {
      await db.deleteParam(r.user.id, String(body.deleteId));
      return NextResponse.json({ ok: true, params: await db.listParams(r.user.id) });
    }

    const kind = String(body.kind || "");
    if (!PARAM_KINDS.includes(kind as (typeof PARAM_KINDS)[number])) {
      return badRequest("Tipo de parámetro no válido.");
    }
    const name = String(body.name || "").trim();
    if (!name) return badRequest("El nombre es obligatorio.");

    const patterns = (Array.isArray(body.patterns) ? body.patterns : []).map((p) => String(p).trim()).filter(Boolean).slice(0, 50);
    for (const p of patterns) {
      try {
        new RegExp(p, "i");
      } catch {
        return badRequest(`Expresión no válida: ${p}`);
      }
    }

    const slug = slugify(String(body.slug || "").trim() || name);
    const id = String(body.id || "") || uid("p_");

    // Si cambió el slug, se borra el registro anterior para no dejar duplicados
    // (la clave única en la base es owner + kind + slug).
    if (body.id) {
      const current = (await db.listParams(r.user.id)).find((p) => String(p.id) === id);
      if (current && String(current.slug) !== slug) await db.deleteParam(r.user.id, id);
    }

    await db.upsertParams([
      {
        id,
        owner_id: r.user.id,
        kind,
        name,
        slug,
        keywords: (Array.isArray(body.keywords) ? body.keywords : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 200),
        patterns,
        color: String(body.color || ""),
        position: Number(body.position ?? 0) || 0,
        archived: Boolean(body.archived),
      },
    ]);

    return NextResponse.json({ ok: true, id, params: await db.listParams(r.user.id) });
  } catch (e) {
    return serverError(e);
  }
}

/** Ajustes generales (carpeta por tipo, área por defecto, datos de firma). */
export async function PUT(req: Request) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const body = await readJson<{ settings?: Row }>(req);
    if (!body.settings || typeof body.settings !== "object") return badRequest("Faltan los ajustes.");
    await getStore().saveSettings(r.user.id, body.settings);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
