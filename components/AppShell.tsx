"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { AuthGate } from "./AuthGate";
import { UploadView } from "./UploadView";
import { DocsView } from "./DocsView";
import { DocView } from "./DocView";
import { SettingsView } from "./SettingsView";
import {
  getAllDocs,
  getAllParams,
  getLocalSettings,
  saveDocLocal,
  type LocalParam,
} from "@/lib/localdb";
import { bootstrap, getSyncState, startAutoSync, subscribeSync, syncNow, type SyncState } from "@/lib/sync";
import type { DocRecord } from "@/lib/schema-defs";

export interface AppSettings {
  typeToFolder: Record<string, string>;
  defaultArea: string;
  org: { name: string; area: string; responsible: string; city: string };
  llm: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  typeToFolder: {
    oficio: "entrada",
    circular: "entrada",
    convenio: "convenios-contratos",
    contrato: "convenios-contratos",
    minuta: "mesas-de-trabajo",
    solicitud: "entrada",
    notificacion: "juridico",
    informe: "archivo-muerto",
    factura: "finanzas",
    queja: "asuntos-laborales",
    otro: "entrada",
  },
  defaultArea: "externo",
  org: { name: "", area: "", responsible: "", city: "Ciudad de México" },
  llm: false,
};

type View = "subir" | "docs" | "detalle" | "ajustes";

export function AppShell() {
  const [boot, setBoot] = useState<"loading" | "login" | "ready">("loading");
  const [needsSetup, setNeedsSetup] = useState(false);
  const [backend, setBackend] = useState("");
  const [bootWarning, setBootWarning] = useState("");
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);

  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [params, setParams] = useState<LocalParam[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sync, setSync] = useState<SyncState>(getSyncState());
  const [view, setView] = useState<View>("docs");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterFolder, setFilterFolder] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState("");
  const [bootError, setBootError] = useState("");

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? "" : t)), 3200);
  }, []);

  const refresh = useCallback(async () => {
    const [d, p, s] = await Promise.all([getAllDocs(), getAllParams(), getLocalSettings()]);
    setDocs(d);
    setParams(p);
    setSettings({ ...DEFAULT_SETTINGS, ...(s as Partial<AppSettings>) });
  }, []);

  /* arranque: sesion, datos locales y sincronizacion */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sys = await fetch("/api/system").then((r) => r.json());
        if (!alive) return;
        setBackend(sys.backend);
        setBootWarning(typeof sys.warning === "string" ? sys.warning : "");
        if (!sys.authenticated) {
          setNeedsSetup(Boolean(sys.needsSetup));
          setBoot("login");
          return;
        }
        await afterLogin(sys);
      } catch (e) {
        if (!alive) return;
        setBootError(e instanceof Error ? e.message : "No se pudo iniciar la aplicacion.");
        setBoot("login");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afterLogin = useCallback(async (sys?: { email?: string; documents?: number }) => {
    try {
      await bootstrap();
    } catch {
      /* sin red: se trabaja con la copia local */
    }
    await refresh();
    startAutoSync();
    const me = await fetch("/api/system").then((r) => r.json()).catch(() => null);
    if (me?.email) setUser({ email: me.email, name: me.name || "" });
    else if (sys?.email) setUser({ email: sys.email, name: "" });
    setBoot("ready");
    applyQueryParams();
  }, [refresh]);

  useEffect(() => subscribeSync(setSync), []);
  // Refresco periódico de la copia local (barato: lectura de IndexedDB)
  useEffect(() => {
    if (boot !== "ready") return;
    const t = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 8000);
    return () => window.clearInterval(t);
  }, [boot, refresh]);

  // Al sincronizar, se refresca la vista con lo que llegó del servidor
  useEffect(() => {
    if (sync.status === "idle" && sync.lastSync) void refresh();
  }, [sync.lastSync, sync.status, refresh]);

  /* navegacion por URL (?vista=, ?doc=, ?carpeta=, ?filtro=) */
  const applyQueryParams = useCallback(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("nuevo") === "1") setView("subir");
    const f = q.get("filtro");
    if (f) {
      setFilterStatus(f);
      setView("docs");
    }
    const carp = q.get("carpeta");
    if (carp) {
      setFilterFolder(carp);
      setView("docs");
    }
    const id = q.get("doc");
    if (id) {
      setSelectedId(id);
      setView("detalle");
    }
  }, []);

  const navigate = useCallback((v: View, opts: { id?: string; folder?: string; status?: string } = {}) => {
    setSidebar(false);
    setView(v);
    if (opts.id !== undefined) setSelectedId(opts.id);
    if (opts.folder !== undefined) setFilterFolder(opts.folder);
    if (opts.status !== undefined) setFilterStatus(opts.status);
    const q = new URLSearchParams();
    if (v === "subir") q.set("nuevo", "1");
    if (v === "ajustes") q.set("vista", "ajustes");
    if (v === "detalle" && opts.id) q.set("doc", opts.id);
    if (v === "docs") {
      if (opts.folder) q.set("carpeta", opts.folder);
      if (opts.status) q.set("filtro", opts.status);
    }
    const url = `${window.location.pathname}${q.toString() ? `?${q}` : ""}`;
    window.history.replaceState({}, "", url);
    window.scrollTo({ top: 0 });
  }, []);

  const saveDoc = useCallback(
    async (doc: DocRecord) => {
      const saved = await saveDocLocal(doc);
      await refresh();
      void syncNow();
      return saved;
    },
    [refresh],
  );

  const persistSettings = useCallback(
    async (next: AppSettings) => {
      setSettings(next);
      const { saveLocalSettings } = await import("@/lib/localdb");
      await saveLocalSettings(next as unknown as Record<string, unknown>);
      await fetch("/api/params", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: next }),
      }).catch(() => undefined);
      notify("Ajustes guardados");
    },
    [notify],
  );

  const counts = useMemo(() => {
    const porCarpeta: Record<string, number> = {};
    let porResponder = 0;
    let enProceso = 0;
    let vencidos = 0;
    for (const d of docs) {
      porCarpeta[d.folder] = (porCarpeta[d.folder] || 0) + 1;
      if (d.needs_response && d.status === "por_responder") porResponder++;
      if (d.status === "en_proceso") enProceso++;
      if (d.due_on && new Date(d.due_on + "T23:59:59").getTime() < Date.now() && d.status !== "respondido") vencidos++;
    }
    return { porCarpeta, porResponder, enProceso, vencidos, total: docs.length };
  }, [docs]);

  const folders = useMemo(() => params.filter((p) => p.kind === "carpeta" && !p.archived), [params]);

  async function logout() {
    await fetch("/api/auth/login", { method: "DELETE" }).catch(() => undefined);
    window.location.href = "/";
  }

  if (boot === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--text-2)" }}>
        <span className="spin dark" /> Cargando SUT STE…
      </div>
    );
  }

  if (boot === "login") {
    if (bootError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card" style={{ maxWidth: 460 }}>
            <h3>No se pudo iniciar</h3>
            <p className="hint">{bootError}</p>
            {/IndexedDB|indexedDB|almacenamiento|storage/i.test(bootError) && (
              <div className="notice warn" style={{ margin: "10px 0" }}>
                El navegador bloqueó el almacenamiento local. Esto ocurre cuando la app se abre
                dentro de un marco incrustado con restricciones: abre la misma dirección en una
                pestaña independiente y funcionará con normalidad.
              </div>
            )}
            <button className="btn primary" onClick={() => window.location.reload()}>Reintentar</button>
          </div>
        </div>
      );
    }
    return <AuthGate needsSetup={needsSetup} backend={backend} warning={bootWarning} onAuthenticated={() => void afterLogin()} />;
  }

  const selected = docs.find((d) => d.id === selectedId) || null;

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setSidebar((s) => !s)} aria-label="Abrir menu">
          <Icon name={sidebar ? "close" : "menu"} size={18} />
        </button>
        <div className="brand">
          <b>SUT STE</b>
          <span>Gestion documental</span>
        </div>
        <div className="spacer" />
        <SyncIndicator sync={sync} onSync={() => void syncNow().then(refresh)} />
        <button
          className="btn primary sm"
          onClick={() => navigate("subir")}
          style={{ borderColor: "rgba(255,255,255,.25)" }}
        >
          <Icon name="plus" size={14} /> Subir
        </button>
      </header>

      <div className="layout">
        {sidebar && <div className="sidebar-backdrop" onClick={() => setSidebar(false)} />}
        <aside className={`sidebar ${sidebar ? "open" : ""}`}>
          <button className={`nav-link ${view === "subir" ? "active" : ""}`} onClick={() => navigate("subir")}>
            <Icon name="upload" /> Nuevo documento
          </button>
          <button className={`nav-link ${view === "docs" && !filterStatus && !filterFolder ? "active" : ""}`} onClick={() => navigate("docs", { folder: "", status: "" })}>
            <Icon name="inbox" /> Todos
            <span className="count">{counts.total}</span>
          </button>
          <button className={`nav-link ${filterStatus === "por_responder" ? "active" : ""}`} onClick={() => navigate("docs", { folder: "", status: "por_responder" })}>
            <Icon name="reply" /> Por responder
            <span className="count">{counts.porResponder}</span>
          </button>
          {counts.vencidos > 0 && (
            <button className={`nav-link ${filterStatus === "vencidos" ? "active" : ""}`} onClick={() => navigate("docs", { folder: "", status: "vencidos" })}>
              <Icon name="alert" /> Plazo vencido
              <span className="count">{counts.vencidos}</span>
            </button>
          )}
          <button className={`nav-link ${view === "ajustes" ? "active" : ""}`} onClick={() => navigate("ajustes")}>
            <Icon name="settings" /> Parametros y ajustes
          </button>

          <div className="nav-title">Carpetas</div>
          {folders.map((f) => (
            <button
              key={f.id}
              className={`nav-link ${view === "docs" && filterFolder === f.slug ? "active" : ""}`}
              onClick={() => navigate("docs", { folder: f.slug, status: "" })}
            >
              <span className="folder-dot" style={{ background: f.color || "var(--blue-500)" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span className="count">{counts.porCarpeta[f.slug] || 0}</span>
            </button>
          ))}
          {!folders.length && <div className="hint" style={{ padding: "4px 10px" }}>Sin carpetas configuradas.</div>}

          <div className="nav-title">Cuenta</div>
          <div className="hint" style={{ padding: "0 10px 6px", wordBreak: "break-all" }}>{user?.email || ""}</div>
          <button className="nav-link" onClick={logout}>
            <Icon name="logout" /> Cerrar sesion
          </button>
        </aside>

        <main className="content">
          {view === "subir" && (
            <UploadView
              params={params}
              settings={settings}
              onSaved={(doc) => {
                notify("Documento archivado");
                navigate("detalle", { id: doc.id });
              }}
              onCancel={() => navigate("docs")}
              saveDoc={saveDoc}
            />
          )}

          {view === "docs" && (
            <DocsView
              docs={docs}
              params={params}
              folder={filterFolder}
              status={filterStatus}
              onOpen={(id) => navigate("detalle", { id })}
              onStatusFilter={(s) => navigate("docs", { folder: filterFolder, status: s })}
              onFolderFilter={(f) => navigate("docs", { folder: f, status: filterStatus })}
              onNew={() => navigate("subir")}
            />
          )}

          {view === "detalle" && (
            <DocView
              doc={selected}
              params={params}
              settings={settings}
              onBack={() => navigate("docs", { folder: filterFolder, status: filterStatus })}
              onSave={async (d) => {
                await saveDoc(d);
                notify("Cambios guardados");
              }}
              onDelete={async (d) => {
                await saveDoc({ ...d, deleted: true });
                notify("Documento eliminado del archivo");
                navigate("docs", { folder: filterFolder, status: filterStatus });
              }}
              notify={notify}
            />
          )}

          {view === "ajustes" && (
            <SettingsView
              params={params}
              settings={settings}
              backend={backend}
              sync={sync}
              docs={docs}
              onSaveSettings={persistSettings}
              onRefreshParams={async () => {
                const data = await fetch("/api/params").then((r) => r.json()).catch(() => null);
                if (data?.params) {
                  const { putParams } = await import("@/lib/localdb");
                  await putParams(data.params as LocalParam[]);
                }
                await refresh();
                notify("Parámetros actualizados");
              }}
              onSync={async () => {
                await syncNow();
                await refresh();
                notify("Sincronización completada");
              }}
              notify={notify}
            />
          )}
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function SyncIndicator({ sync, onSync }: { sync: SyncState; onSync: () => void }) {
  const offline = sync.status === "offline" || (typeof navigator !== "undefined" && !navigator.onLine);
  const label =
    sync.status === "syncing"
      ? "Sincronizando"
      : offline
        ? "Sin conexion"
        : sync.status === "error"
          ? "Error al sincronizar"
          : sync.status === "unauthenticated"
            ? "Sesion vencida"
            : sync.pending > 0
              ? `${sync.pending} por sincronizar`
              : sync.lastSync
                ? "Al día"
                : "Listo";

  return (
    <button
      className={`sync ${offline || sync.status === "error" ? "off" : ""}`}
      onClick={onSync}
      title={sync.message || "Toca para sincronizar ahora"}
      style={{ cursor: "pointer", background: "transparent" }}
    >
      {sync.status === "syncing" ? (
        <span className="spin" />
      ) : (
        <Icon name={offline ? "cloudOff" : "cloud"} size={13} />
      )}
      <span className="lbl">{label}</span>
    </button>
  );
}
