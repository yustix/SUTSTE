import { NextResponse } from "next/server";
import { requireUser, serverError } from "@/lib/api-helpers";
import { getStore, isNeonConfigured } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string[] }> };

/**
 * Sirve los archivos guardados en disco (solo desarrollo).
 * Con Vercel Blob los archivos se sirven desde su propia URL.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;

    if (isNeonConfigured()) {
      return NextResponse.json({ error: "Los archivos se sirven desde Vercel Blob." }, { status: 404 });
    }

    const { key } = await ctx.params;
    const joined = (key || []).join("/");
    if (!joined || joined.includes("..")) {
      return NextResponse.json({ error: "Ruta no válida." }, { status: 400 });
    }

    const found = await getStore().readLocalFile(joined);
    if (!found) return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });

    return new NextResponse(new Uint8Array(found.buf), {
      status: 200,
      headers: {
        "Content-Type": found.mime,
        "Content-Length": String(found.buf.length),
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
