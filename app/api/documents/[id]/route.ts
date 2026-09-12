import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { requireUser, readJson, serverError, badRequest } from "@/lib/api-helpers";
import type { DocRecord } from "@/lib/schema-defs";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const { id } = await ctx.params;
    const doc = await getStore().getDocument(r.user.id, id);
    if (!doc) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
    return NextResponse.json({ doc });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const { id } = await ctx.params;
    const db = getStore();
    const existing = await db.getDocument(r.user.id, id);
    if (!existing) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });

    const patch = await readJson<Partial<DocRecord>>(req);
    const merged: DocRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      owner_id: existing.owner_id,
      rev: existing.rev + 1,
      updated_at: new Date().toISOString(),
    };
    const [saved] = await db.upsertDocuments([merged]);
    return NextResponse.json({ doc: saved });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const { id } = await ctx.params;
    const hard = new URL(req.url).searchParams.get("hard") === "1";
    const db = getStore();
    if (hard) {
      return badRequest("El borrado definitivo no esta habilitado; el documento se marca como eliminado y se sincroniza.");
    }
    await db.deleteDocument(r.user.id, id);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return serverError(e);
  }
}
