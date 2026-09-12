"use client";

/**
 * Sincronizacion local-first.
 * - Los cambios se guardan siempre en IndexedDB y se encolan en un outbox.
 * - El outbox se envia al servidor (Neon) y se recuperan los cambios remotos.
 * - Conflicto: gana la version mas reciente (rev + updated_at).
 */

import type { DocRecord } from "./schema-defs";
import {
  clearDirtyFlags,
  dirtyDocs,
  getAllDocs,
  getMeta,
  mergeDoc,
  putDocs,
  putParams,
  setMeta,
  type LocalParam,
} from "./localdb";

export type SyncStatus = "idle" | "syncing" | "offline" | "error" | "unauthenticated";

export interface SyncState {
  status: SyncStatus;
  pending: number;
  lastSync: number | null;
  message: string;
  backend: string;
}

const META_SINCE = "sync.since";
const META_LAST = "sync.last";

let state: SyncState = { status: "idle", pending: 0, lastSync: null, message: "", backend: "" };
const listeners = new Set<(s: SyncState) => void>();
let running: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

async function refreshPending() {
  const dirty = await dirtyDocs();
  set({ pending: dirty.length });
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401) throw Object.assign(new Error("unauthenticated"), { code: 401 });
  if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
  return data;
}

export async function syncNow(): Promise<void> {
  if (running) return running;
  running = doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    set({ status: "offline", message: "Sin conexion: los cambios quedan guardados en este dispositivo." });
    await refreshPending();
    return;
  }
  set({ status: "syncing", message: "Sincronizando…" });
  try {
    const since = Number((await getMeta<number>(META_SINCE)) || 0);
    const dirty = await dirtyDocs();

    const changes: Partial<DocRecord>[] = dirty.map((d) => {
      const { dirty: _flag, ...rest } = d as DocRecord & { dirty?: boolean };
      void _flag;
      // el texto completo solo viaja la primera vez; despues se manda igual para mantener
      // la copia remota consistente (los documentos de esta app son texto, no binarios)
      return rest;
    });

    const data = await fetchJson("/api/documents/sync", {
      method: "POST",
      body: JSON.stringify({ since, changes }),
    });

    if (Array.isArray(data?.docs)) {
      const local = await getAllDocs();
      const localMap = new Map(local.map((d) => [d.id, d]));
      const merged: DocRecord[] = [];
      for (const remote of data.docs as DocRecord[]) {
        const m = mergeDoc(localMap.get(remote.id), remote);
        merged.push(m);
        localMap.set(m.id, m);
      }
      if (merged.length) await putDocs(merged);
    }

    // Los cambios rechazados por version antigua ya existen en el servidor,
    // por lo que tambien se liberan de la cola: el pull trae el estado ganador.
    void dirty;
    await clearDirtyFlags();
    if (typeof data?.serverTime === "number") await setMeta(META_SINCE, data.serverTime);
    await setMeta(META_LAST, Date.now());
    await refreshPending();
    set({ status: "idle", lastSync: Date.now(), message: "", backend: data?.backend || state.backend });
  } catch (e: any) {
    if (e?.code === 401 || e?.message === "unauthenticated") {
      set({ status: "unauthenticated", message: "Sesion vencida." });
      return;
    }
    await refreshPending();
    set({
      status: navigator.onLine === false ? "offline" : "error",
      message: e?.message || "No se pudo sincronizar.",
    });
  }
}

/** Descarga inicial: todos los documentos + parametros del servidor. */
export async function bootstrap(): Promise<{ docs: DocRecord[]; backend: string }> {
  const sys = await fetchJson("/api/system");
  set({ backend: sys?.backend || "" });
  const [full, params] = await Promise.all([
    fetchJson("/api/documents"),
    fetchJson("/api/params").catch(() => ({ params: [] })),
  ]);
  const local = await getAllDocs();
  const localMap = new Map(local.map((d) => [d.id, d]));
  const merged: DocRecord[] = [];
  for (const remote of (full?.docs || []) as DocRecord[]) {
    const m = mergeDoc(localMap.get(remote.id), remote);
    merged.push(m);
    localMap.set(m.id, m);
  }
  // los locales que no existen en el servidor se conservan (se subiran en el siguiente push)
  const remoteIds = new Set((full?.docs || []).map((d: DocRecord) => d.id));
  for (const l of local) if (!remoteIds.has(l.id)) merged.push(l);

  if (merged.length) await putDocs(merged);
  if (Array.isArray(params?.params) && params.params.length) {
    await putParams(params.params as LocalParam[]);
  }
  await setMeta(META_SINCE, Number(full?.serverTime) || Date.now());
  await setMeta(META_LAST, Date.now());
  await refreshPending();
  set({ status: "idle", lastSync: Date.now(), message: "", backend: sys?.backend || "" });
  return { docs: await getAllDocs(), backend: sys?.backend || "" };
}

export function startAutoSync(intervalMs = 45000) {
  if (typeof window === "undefined") return;
  void refreshPending();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (navigator.onLine) void syncNow();
  }, intervalMs);
  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () =>
    set({ status: "offline", message: "Sin conexion: los cambios quedan guardados en este dispositivo." }),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) void syncNow();
  });
  // ultimo intento de subida antes de cerrar la pestana
  window.addEventListener("pagehide", () => {
    void dirtyDocs().then((docs) => {
      if (!docs.length || !navigator.onLine) return;
      const payload = JSON.stringify({ since: 0, changes: docs });
      try {
        navigator.sendBeacon?.("/api/documents/sync", new Blob([payload], { type: "application/json" }));
      } catch {
        /* sin soporte: se reintentara al abrir la app */
      }
    });
  });
}
