import { NextResponse } from "next/server";
import { requireUser, serverError } from "@/lib/api-helpers";
import { blobConfigured, putFile } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Subida del archivo original cuando NO hay Vercel Blob configurado.
 * Solo sirve en desarrollo: en Vercel el sistema de archivos es de solo lectura.
 * En producción el navegador sube directo a Blob con /api/upload-token.
 */
export async function POST(req: Request) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;

    if (blobConfigured()) {
      return NextResponse.json(
        { error: "Vercel Blob está activo: la subida debe hacerse directo desde el navegador." },
        { status: 409 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo supera los 40 MB." }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await putFile(r.user.id, file.name || "documento", buf, file.type || "application/octet-stream");
    return NextResponse.json({ url: stored.url, key: stored.key });
  } catch (e) {
    return serverError(e);
  }
}
