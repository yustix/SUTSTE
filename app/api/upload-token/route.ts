import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/api-helpers";
import { blobConfigured } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 40 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
  "application/octet-stream",
];

/**
 * Emite el token de corta duración con el que el navegador sube el archivo
 * directo a Vercel Blob. Así el binario nunca atraviesa la Serverless Function
 * y no choca con el límite de 4.5 MB del cuerpo de la petición.
 */
export async function POST(request: Request) {
  const r = await requireUser();
  if ("error" in r) return r.error;

  if (!blobConfigured()) {
    return NextResponse.json(
      { error: "Vercel Blob no está configurado (falta BLOB_READ_WRITE_TOKEN)." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Cuerpo de la petición no válido." }, { status: 400 });

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ ownerId: r.user.id, pathname }),
      }),
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // El documento se registra en /api/documents/sync; aquí solo se deja rastro.
        console.log("[blob] subida completada", blob.pathname, tokenPayload);
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo autorizar la subida." },
      { status: 400 },
    );
  }
}
