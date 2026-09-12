import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { requireUser, readJson, serverError } from "@/lib/api-helpers";
import type { DocRecord } from "@/lib/schema-defs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SyncBody {
  since?: number;
  changes?: Partial<DocRecord>[];
}

const TEXT_FIELDS = [
  "title", "file_name", "mime_type", "file_url", "file_key", "text_content", "summary",
  "doc_type", "folder", "area", "priority", "status", "sender", "recipient", "doc_number",
  "received_on", "due_on", "doc_date", "response_hint", "response_draft", "response_sent_at", "notes",
] as const;

function sanitize(input: Partial<DocRecord>, ownerId: string, existing: DocRecord | null): DocRecord | null {
  if (!input.id || typeof input.id !== "string") return null;
  const base =
    existing ??
    ({
      id: input.id,
      owner_id: ownerId,
      title: "",
      file_name: "",
      mime_type: "",
      size_bytes: 0,
      file_url: null,
      file_key: null,
      text_content: "",
      summary: "",
      key_points: [],
      entities: {},
      doc_type: "",
      folder: "",
      area: "",
      priority: "",
      status: "archivado",
      sender: "",
      recipient: "",
      doc_number: "",
      received_on: null,
      due_on: null,
      doc_date: null,
      needs_response: false,
      response_hint: "",
      confidence: 0,
      tags: [],
      response_draft: "",
      response_sent_at: null,
      notes: "",
      rev: 0,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as DocRecord);

  const merged: DocRecord = { ...base, owner_id: ownerId };
  for (const f of TEXT_FIELDS) {
    if (f in input) {
      const v = (input as unknown as Record<string, unknown>)[f];
      (merged as unknown as Record<string, unknown>)[f] = v == null ? null : String(v);
    }
  }
  if ("size_bytes" in input) merged.size_bytes = Number(input.size_bytes) || 0;
  if ("confidence" in input) merged.confidence = Number(input.confidence) || 0;
  if ("needs_response" in input) merged.needs_response = Boolean(input.needs_response);
  if ("deleted" in input) merged.deleted = Boolean(input.deleted);
  if ("key_points" in input && Array.isArray(input.key_points)) merged.key_points = input.key_points.map(String).slice(0, 30);
  if ("tags" in input && Array.isArray(input.tags)) merged.tags = input.tags.map(String).slice(0, 40);
  if ("entities" in input && input.entities && typeof input.entities === "object") {
    merged.entities = input.entities as Record<string, unknown>;
  }
  if ("created_at" in input && input.created_at) merged.created_at = String(input.created_at);

  merged.rev = Number(input.rev) || base.rev + 1;
  merged.updated_at = new Date().toISOString();
  return merged;
}

/**
 * Sincronizacion bidireccional.
 * GET  /api/documents/sync?since=<ms>  -> documentos modificados desde esa marca
 * POST { since, changes }              -> aplica cambios y devuelve el estado resultante
 */
export async function GET(req: Request) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const since = Number(new URL(req.url).searchParams.get("since") || 0);
    const db = getStore();
    const docs = await db.documentsChangedSince(r.user.id, since);
    return NextResponse.json({ docs, serverTime: Date.now() });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: Request) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;
    const body = await readJson<SyncBody>(req);
    const db = getStore();
    const since = Number(body.since || 0);
    const changes = Array.isArray(body.changes) ? body.changes.slice(0, 200) : [];

    const applied: DocRecord[] = [];
    const rejected: { id: string; reason: string }[] = [];

    for (const change of changes) {
      const id = String(change?.id || "");
      if (!id) {
        rejected.push({ id: "", reason: "Falta el identificador" });
        continue;
      }
      const existing = await db.getDocument(r.user.id, id);
      if (existing) {
        const incomingRev = Number(change.rev) || 0;
        const incomingTime = new Date(String(change.updated_at || 0)).getTime() || 0;
        const currentTime = new Date(existing.updated_at).getTime();
        const stale = incomingRev < existing.rev && incomingTime <= currentTime;
        if (stale) {
          rejected.push({ id, reason: "Version anterior descartada" });
          continue;
        }
      }
      const merged = sanitize(change, r.user.id, existing);
      if (!merged) {
        rejected.push({ id, reason: "Datos no validos" });
        continue;
      }
      // nunca permitir reasignar el documento a otro usuario
      merged.owner_id = r.user.id;
      const [saved] = await db.upsertDocuments([merged]);
      applied.push(saved);
    }

    const docs = await db.documentsChangedSince(r.user.id, since);
    return NextResponse.json({ applied, rejected, docs, serverTime: Date.now() });
  } catch (e) {
    return serverError(e);
  }
}
