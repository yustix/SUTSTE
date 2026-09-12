import { getStore } from "./store";
import { slugify, uid } from "./util";

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export interface StoredFile {
  url: string;
  key: string;
}

/**
 * Guarda el archivo original del documento.
 * - Con BLOB_READ_WRITE_TOKEN: Vercel Blob (produccion, persistente).
 * - Sin token: disco local ./.data/uploads (solo desarrollo).
 */
export async function putFile(
  ownerId: string,
  fileName: string,
  data: Uint8Array | Buffer,
  contentType: string,
): Promise<StoredFile> {
  const ext = (fileName.split(".").pop() || "bin").toLowerCase().slice(0, 8);
  const base = slugify(fileName.replace(/\.[^.]+$/, "")).slice(0, 48) || "documento";
  const key = `${ownerId}/${new Date().toISOString().slice(0, 7)}/${base}-${uid()}.${ext}`;

  if (blobConfigured()) {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, data as unknown as Buffer, {
      contentType: contentType || "application/octet-stream",
      addRandomSuffix: false,
      access: "public",
    });
    return { url: blob.url, key };
  }

  const url = await getStore().saveLocalFile(key, Buffer.from(data), contentType);
  return { url, key };
}

export function isPublicUrl(url: string | null | undefined): boolean {
  return Boolean(url && /^https?:\/\//.test(url));
}
