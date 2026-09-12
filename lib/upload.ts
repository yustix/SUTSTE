"use client";

/**
 * Subida del archivo original.
 * - Produccion (BLOB_READ_WRITE_TOKEN): subida directa del navegador a Vercel Blob
 *   mediante client upload token, sin pasar por la Serverless Function.
 * - Desarrollo o sin Blob: multipart a /api/upload (disco local).
 */

export interface UploadResult {
  url: string;
  key: string;
}

function safeName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-120) || "documento"
  );
}

export async function uploadFile(
  file: File,
  onProgress?: (step: string, pct: number) => void,
): Promise<UploadResult> {
  const sys = await fetch("/api/system").then((r) => r.json()).catch(() => null);
  const useBlob = sys?.blob === "vercel-blob";

  if (useBlob) {
    onProgress?.("Subiendo a la nube…", 78);
    const { upload } = await import("@vercel/blob/client");
    const month = new Date().toISOString().slice(0, 7);
    const pathname = `${month}/${safeName(file.name)}`;
    const blob = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/upload-token",
      multipart: file.size > 4 * 1024 * 1024,
      onUploadProgress: (p) => onProgress?.("Subiendo a la nube…", 78 + Math.round((p.percentage || 0) * 0.2)),
    });
    return { url: blob.url, key: blob.pathname };
  }

  onProgress?.("Guardando el archivo…", 80);
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error || `Error ${res.status} al guardar el archivo`);
  }
  const data = await res.json();
  return { url: data.url, key: data.key };
}
