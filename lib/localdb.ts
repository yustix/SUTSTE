"use client";

/**
 * Capa local-first en IndexedDB.
 * Guarante que la app funcione sin red y que PC y movil converjan al sincronizar.
 */

import type { DocRecord } from "./schema-defs";

const DB_NAME = "sut-ste";
const DB_VERSION = 1;

export const S_DOCS = "documents";
export const S_PARAMS = "params";
export const S_OUTBOX = "outbox";
export const S_META = "meta";
export const S_SETTINGS = "settings";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB no disponible en este navegador."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(S_DOCS)) {
        const s = db.createObjectStore(S_DOCS, { keyPath: "id" });
        s.createIndex("updated_at", "updated_at");
        s.createIndex("folder", "folder");
        s.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains(S_PARAMS)) db.createObjectStore(S_PARAMS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(S_OUTBOX)) db.createObjectStore(S_OUTBOX, { keyPath: "id" });
      if (!db.objectStoreNames.contains(S_META)) db.createObjectStore(S_META, { keyPath: "key" });
      if (!db.objectStoreNames.contains(S_SETTINGS)) db.createObjectStore(S_SETTINGS, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

function all<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, "readonly", (s) => s.getAll());
}

/* ------------------------------ meta ------------------------------ */

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const r = await tx<{ key: string; value: T } | undefined>(S_META, "readonly", (s) => s.get(key));
  return r?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(S_META, "readwrite", (s) => s.put({ key, value }));
}

/* --------------------------- documentos --------------------------- */

export async function getAllDocs(): Promise<DocRecord[]> {
  const docs = await all<DocRecord>(S_DOCS);
  return docs.filter((d) => !d.deleted).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

export async function getDoc(id: string): Promise<DocRecord | undefined> {
  return tx<DocRecord | undefined>(S_DOCS, "readonly", (s) => s.get(id));
}

export async function putDoc(doc: DocRecord): Promise<void> {
  await tx(S_DOCS, "readwrite", (s) => s.put(doc));
}

export async function putDocs(docs: DocRecord[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(S_DOCS, "readwrite");
    const store = t.objectStore(S_DOCS);
    for (const d of docs) store.put(d);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Fusiona un documento remoto con el local: gana la version mas reciente. */
export function mergeDoc(local: DocRecord | undefined, remote: DocRecord): DocRecord {
  if (!local) return remote;
  const lt = new Date(local.updated_at || 0).getTime();
  const rt = new Date(remote.updated_at || 0).getTime();
  if (local.rev > remote.rev && lt > rt) return local;
  if (local.rev === remote.rev) return rt >= lt ? remote : local;
  return rt >= lt || remote.rev > local.rev ? remote : local;
}

/**
 * Guarda un cambio local y lo encola para sincronizar.
 * `dirty` se marca en el propio registro para saber que falta subirlo.
 */
export async function saveDocLocal(doc: DocRecord): Promise<DocRecord> {
  const withMeta: DocRecord & { dirty?: boolean } = {
    ...doc,
    rev: (doc.rev || 0) + 1,
    updated_at: new Date().toISOString(),
  };
  withMeta.dirty = true;
  await putDoc(withMeta as DocRecord);
  await enqueue(withMeta.id);
  return withMeta as DocRecord;
}

/* ------------------------------ outbox ---------------------------- */

export async function enqueue(id: string): Promise<void> {
  await tx(S_OUTBOX, "readwrite", (s) => s.put({ id, at: Date.now() }));
}

export async function dequeue(id: string): Promise<void> {
  await tx(S_OUTBOX, "readwrite", (s) => s.delete(id));
}

export async function outboxIds(): Promise<string[]> {
  const rows = await all<{ id: string; at: number }>(S_OUTBOX);
  return rows.sort((a, b) => a.at - b.at).map((r) => r.id);
}

export async function clearOutbox(): Promise<void> {
  await tx(S_OUTBOX, "readwrite", (s) => s.clear());
}

export async function dirtyDocs(): Promise<DocRecord[]> {
  const ids = await outboxIds();
  if (!ids.length) return [];
  const docs = await all<DocRecord>(S_DOCS);
  const map = new Map(docs.map((d) => [d.id, d]));
  return ids.map((id) => map.get(id)).filter(Boolean) as DocRecord[];
}

export async function clearDirtyFlags(): Promise<void> {
  const ids = await outboxIds();
  const docs = await all<DocRecord>(S_DOCS);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(S_DOCS, "readwrite");
    const store = t.objectStore(S_DOCS);
    for (const d of docs) {
      if (ids.includes(d.id)) {
        const { dirty, ...rest } = d as DocRecord & { dirty?: boolean };
        void dirty;
        store.put(rest);
      }
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/* --------------------------- parametros --------------------------- */

export interface LocalParam {
  id: string;
  kind: string;
  name: string;
  slug: string;
  keywords: string[];
  patterns: string[];
  color?: string;
  position?: number;
  archived?: boolean;
}

export async function getAllParams(): Promise<LocalParam[]> {
  const rows = await all<LocalParam>(S_PARAMS);
  return rows.sort((a, b) => (a.kind || "").localeCompare(b.kind || "") || (a.position || 0) - (b.position || 0));
}

export async function putParams(params: LocalParam[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(S_PARAMS, "readwrite");
    const store = t.objectStore(S_PARAMS);
    store.clear();
    for (const p of params) store.put(p);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/* ---------------------------- ajustes ----------------------------- */

export async function getLocalSettings(): Promise<Record<string, unknown>> {
  const r = await tx<{ key: string; value: Record<string, unknown> } | undefined>(S_SETTINGS, "readonly", (s) =>
    s.get("app"),
  );
  return r?.value || {};
}

export async function saveLocalSettings(data: Record<string, unknown>): Promise<void> {
  await tx(S_SETTINGS, "readwrite", (s) => s.put({ key: "app", value: data }));
}
