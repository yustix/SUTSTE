import { NextResponse } from "next/server";
import { getStore, isNeonConfigured } from "@/lib/store";
import { getSession } from "@/lib/auth";
import { blobConfigured } from "@/lib/files";

export const dynamic = "force-dynamic";

/**
 * Estado general del backend. Lo consulta la app al arrancar para saber:
 * - que almacenamiento hay (Neon en la nube o JSON local de desarrollo)
 * - si ya hay sesion iniciada y si hay que crear la primera cuenta
 * - si los archivos van a Vercel Blob o al disco
 * - si hay resumen con IA configurado
 */
export async function GET() {
  try {
    const db = getStore();
    const [count, user] = await Promise.all([db.countUsers(), getSession()]);

    // En Vercel el sistema de archivos es de solo lectura: si no hay DATABASE_URL
    // la app no puede guardar nada y hay que decirlo con claridad.
    const readOnly = db.readOnly;
    const warning = readOnly
      ? "Falta DATABASE_URL: en Vercel el disco es de solo lectura, así que la app no puede guardar usuarios ni documentos. Crea una base en Neon, pega DATABASE_URL en las variables de entorno del proyecto y vuelve a desplegar."
      : !blobConfigured() && Boolean(process.env.VERCEL)
        ? "Falta BLOB_READ_WRITE_TOKEN: los archivos originales no se podrán guardar (en Vercel no se puede escribir en disco). Conecta un almacén de Vercel Blob al proyecto."
        : "";

    return NextResponse.json({
      backend: db.kind,
      database: isNeonConfigured() ? "neon" : "local",
      readOnly,
      warning,
      blob: blobConfigured() ? "vercel-blob" : "local",
      llm: Boolean(process.env.LLM_API_KEY),
      authenticated: Boolean(user),
      needsSetup: count === 0,
      email: user?.email || "",
      name: user?.name || "",
      serverTime: Date.now(),
      version: 1,
    });
  } catch (e) {
    console.error("[system]", e);
    return NextResponse.json(
      {
        backend: "local",
        database: "local",
        readOnly: true,
        warning: e instanceof Error ? e.message : "No se pudo consultar el estado del servidor.",
        blob: "local",
        llm: false,
        authenticated: false,
        needsSetup: false,
        email: "",
        name: "",
        serverTime: Date.now(),
      },
      { status: 500 },
    );
  }
}
