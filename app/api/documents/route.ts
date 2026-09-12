import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { requireUser, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Lista completa de documentos del usuario (para la primera sincronizacion). */
export async function GET() {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const db = getStore();
    const docs = await db.listDocuments(r.user.id);
    return NextResponse.json({ docs, serverTime: Date.now(), backend: db.kind });
  } catch (e) {
    return serverError(e);
  }
}
