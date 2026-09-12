"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { getAllDocs, getMeta, putDocs, putParams, saveDocLocal, saveLocalSettings, type LocalParam } from "@/lib/localdb";
import { slugify } from "@/lib/util";
import { DOC_STATUSES } from "@/lib/schema-defs";
import type { DocRecord } from "@/lib/schema-defs";
import type { AppSettings } from "./AppShell";
import type { SyncState } from "@/lib/sync";

interface Props {
  params: LocalParam[];
  settings: AppSettings;
  backend: string;
  sync: SyncState;
  docs: DocRecord[];
  onSaveSettings: (s: AppSettings) => Promise<void>;
  onRefreshParams: () => Promise<void>;
  onSync: () => Promise<void>;
  notify: (msg: string) => void;
}

const KIND_LABEL: Record<string, string> = { tipo: "Tipos de documento", carpeta: "Carpetas", area: "Areas" };

export function SettingsView({ params, settings, backend, sync, docs, onSaveSettings, onRefreshParams, onSync, notify }: Props) {
  const [tab, setTab] = useState<"parametros" | "reglas" | "datos">("parametros");
  const [kind, setKind] = useState<"tipo" | "carpeta" | "area">("tipo");
  const [editing, setEditing] = useState<LocalParam | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sinceMark, setSinceMark] = useState<string>("—");

  useEffect(() => {
    getMeta<number>("sync.since")
      .then((v) => setSinceMark(v ? new Date(v).toLocaleString("es-MX") : "sin marca"))
      .catch(() => setSinceMark("no disponible"));
  }, [sync.lastSync]);

  const list = useMemo(() => params.filter((p) => p.kind === kind), [params, kind]);
  const tipos = useMemo(() => params.filter((p) => p.kind === "tipo"), [params]);
  const carpetas = useMemo(() => params.filter((p) => p.kind === "carpeta"), [params]);

  function newParam() {
    setEditing({
      id: "",
      kind,
      name: "",
      slug: "",
      keywords: [],
      patterns: [],
      color: kind === "carpeta" || kind === "tipo" ? "#1e6fbd" : "",
      position: list.length,
    });
    setError("");
  }

  async function saveParam() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      if (!editing.name.trim()) throw new Error("El nombre es obligatorio.");
      for (const p of editing.patterns || []) {
        try {
          new RegExp(p, "i");
        } catch {
          throw new Error(`Expresión no valida: ${p}`);
        }
      }
      const body = {
        id: editing.id || undefined,
        kind: editing.kind,
        name: editing.name.trim(),
        slug: editing.slug || slugify(editing.name),
        keywords: editing.keywords || [],
        patterns: editing.patterns || [],
        color: editing.color || "",
        position: editing.position ?? 0,
      };
      const res = await fetch("/api/params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No se pudo guardar el parámetro.");
      await onRefreshParams();
      setEditing(null);
      notify("Parámetro guardado");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  async function removeParam(p: LocalParam) {
    if (!window.confirm(`Eliminar "${p.name}"? Los documentos ya archivados conservan su valor.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteId: p.id }),
      });
      if (!res.ok) throw new Error("No se pudo eliminar.");
      await onRefreshParams();
      notify("Parámetro eliminado");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    const all = await getAllDocs();
    const payload = {
      app: "SUT STE",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      params,
      documents: all,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sut-ste-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Respaldo exportado con ${all.length} documentos`);
  }

  async function importBackup(file: File) {
    setBusy(true);
    setError("");
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== "SUT STE" || !Array.isArray(data.documents)) {
        throw new Error("El archivo no es un respaldo valido de SUT STE.");
      }
      await putDocs(data.documents as DocRecord[]);
      for (const d of data.documents as DocRecord[]) await saveDocLocal(d);
      if (Array.isArray(data.params) && data.params.length) await putParams(data.params as LocalParam[]);
      if (data.settings) {
        const merged = { ...settings, ...(data.settings as Partial<AppSettings>) };
        await saveLocalSettings(merged as unknown as Record<string, unknown>);
        await fetch("/api/params", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: merged }),
        }).catch(() => undefined);
      }
      await onSync();
      notify(`Respaldo importado: ${data.documents.length} documentos`);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar el respaldo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Parametros y ajustes</h1>
      <p className="page-sub">
        Define como se archiva cada documento, las reglas de clasificacion automatica y el estado de la sincronizacion.
      </p>

      <div className="tabs">
        <button className={`tab ${tab === "parametros" ? "active" : ""}`} onClick={() => setTab("parametros")}>Parametros</button>
        <button className={`tab ${tab === "reglas" ? "active" : ""}`} onClick={() => setTab("reglas")}>Reglas y datos de firma</button>
        <button className={`tab ${tab === "datos" ? "active" : ""}`} onClick={() => setTab("datos")}>Sincronizacion y respaldo</button>
      </div>

      {error && <div className="notice err" style={{ marginBottom: 12 }}>{error}</div>}

      {tab === "parametros" && (
        <>
          <div className="toolbar">
            {(["tipo", "carpeta", "area"] as const).map((k) => (
              <button key={k} className={`btn sm ${kind === k ? "primary" : ""}`} onClick={() => { setKind(k); setEditing(null); }}>
                {KIND_LABEL[k]} <span className="muted">({params.filter((p) => p.kind === k).length})</span>
              </button>
            ))}
            <div className="grow" />
            <button className="btn primary sm" onClick={newParam}><Icon name="plus" size={14} /> Nuevo</button>
          </div>

          <div className="card">
            <h2>{KIND_LABEL[kind]}</h2>
            <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
              {kind === "tipo"
                ? "El tipo se detecta con las palabras clave y expresiones del documento. Determina el trato que se le da (responder o solo archivar)."
                : kind === "carpeta"
                  ? "Carpeta destino del archivo. Si defines palabras clave propias, tienen prioridad sobre la regla por tipo."
                  : "Área o unidad responsable. Se detecta con el encabezado, el destinatario y sus palabras clave."}
            </p>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    {kind !== "area" && <th>Color</th>}
                    <th>Palabras clave</th>
                    <th>Expresiones</th>
                    <th className="right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div className="muted mono" style={{ fontSize: 11.5 }}>{p.slug}</div>
                      </td>
                      {kind !== "area" && (
                        <td>
                          <span className="row" style={{ gap: 6 }}>
                            <span className="folder-dot" style={{ background: p.color || "var(--blue-500)" }} />
                            <span className="muted mono" style={{ fontSize: 11.5 }}>{p.color || "—"}</span>
                          </span>
                        </td>
                      )}
                      <td style={{ maxWidth: 260 }}>
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          {(p.keywords || []).slice(0, 6).join(", ")}
                          {(p.keywords || []).length > 6 ? ` y ${(p.keywords || []).length - 6} más` : ""}
                          {!(p.keywords || []).length && "—"}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{(p.patterns || []).length || "—"}</td>
                      <td className="right nowrap">
                        <button className="btn ghost sm" onClick={() => { setEditing(p); setError(""); }}><Icon name="edit" size={13} /></button>
                        <button className="btn ghost sm" onClick={() => removeParam(p)}><Icon name="trash" size={13} /></button>
                      </td>
                    </tr>
                  ))}
                  {!list.length && (
                    <tr><td colSpan={5} className="empty">Sin parametros de este tipo.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {editing && (
            <div className="modal-bg" onClick={() => !busy && setEditing(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>{editing.id ? "Editar parámetro" : "Nuevo parámetro"}</h3>
                <div className="grid cols-2" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label>Nombre</label>
                    <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Identificador (slug)</label>
                    <input
                      className="input mono"
                      value={editing.slug || slugify(editing.name)}
                      onChange={(e) => setEditing({ ...editing, slug: slugify(e.target.value) })}
                    />
                  </div>
                  {kind !== "area" && (
                    <div className="field">
                      <label>Color</label>
                      <input type="color" className="input" style={{ height: 38, padding: 3 }} value={editing.color || "#1e6fbd"} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
                    </div>
                  )}
                  <div className="field">
                    <label>Posicion</label>
                    <input type="number" className="input" value={editing.position ?? 0} onChange={(e) => setEditing({ ...editing, position: Number(e.target.value) })} />
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label>Palabras clave (una por linea)</label>
                    <textarea
                      className="textarea"
                      value={(editing.keywords || []).join("\n")}
                      onChange={(e) => setEditing({ ...editing, keywords: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                      placeholder={"oficio\nsolicito\nasunto"}
                    />
                    <span className="hint">Se buscan en el encabezado y en todo el texto, sin distinguir mayusculas ni acentos.</span>
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label>Expresiones regulares (una por linea, opcional)</label>
                    <textarea
                      className="textarea mono"
                      value={(editing.patterns || []).join("\n")}
                      onChange={(e) => setEditing({ ...editing, patterns: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                      placeholder={"oficio\\s*(num|no)?\\.?\\s*[a-z0-9/-]+"}
                    />
                  </div>
                </div>
                <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
                  <button className="btn ghost" onClick={() => setEditing(null)} disabled={busy}>Cancelar</button>
                  <button className="btn primary" onClick={saveParam} disabled={busy}>
                    {busy ? <span className="spin" /> : <Icon name="save" size={14} />} Guardar
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "reglas" && (
        <>
          <div className="card">
            <h2>Carpeta por defecto segun el tipo de documento</h2>
            <p className="hint" style={{ marginTop: -6 }}>
              Cuando una carpeta no tiene palabras clave propias, el documento se archiva aqui segun su tipo detectado.
            </p>
            <div className="grid cols-2">
              {tipos.map((t) => (
                <div className="field" key={t.id}>
                  <label>{t.name}</label>
                  <select
                    className="select"
                    value={settings.typeToFolder?.[t.slug] || ""}
                    onChange={(e) =>
                      onSaveSettings({
                        ...settings,
                        typeToFolder: { ...(settings.typeToFolder || {}), [t.slug]: e.target.value },
                      })
                    }
                  >
                    <option value="">Sin asignar</option>
                    {carpetas.map((c) => (
                      <option key={c.id} value={c.slug}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="grid cols-2" style={{ marginTop: 14 }}>
              <div className="field">
                <label>Area por defecto cuando no se detecta</label>
                <select
                  className="select"
                  value={settings.defaultArea}
                  onChange={(e) => onSaveSettings({ ...settings, defaultArea: e.target.value })}
                >
                  {params.filter((p) => p.kind === "area").map((a) => (
                    <option key={a.id} value={a.slug}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Datos para el borrador de respuesta</h2>
            <p className="hint" style={{ marginTop: -6 }}>
              Se usan al generar la plantilla de respuesta. Nada de esto se envia a terceros.
            </p>
            <div className="grid cols-2">
              <div className="field">
                <label>Nombre de la organizacion o area que firma</label>
                <input className="input" value={settings.org?.name || ""} onChange={(e) => onSaveSettings({ ...settings, org: { ...settings.org, name: e.target.value } })} />
              </div>
              <div className="field">
                <label>Cargo de quien firma</label>
                <input className="input" value={settings.org?.responsible || ""} onChange={(e) => onSaveSettings({ ...settings, org: { ...settings.org, responsible: e.target.value } })} />
              </div>
              <div className="field">
                <label>Area o departamento</label>
                <input className="input" value={settings.org?.area || ""} onChange={(e) => onSaveSettings({ ...settings, org: { ...settings.org, area: e.target.value } })} />
              </div>
              <div className="field">
                <label>Ciudad</label>
                <input className="input" value={settings.org?.city || ""} onChange={(e) => onSaveSettings({ ...settings, org: { ...settings.org, city: e.target.value } })} />
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Estatus disponibles</h2>
            <div className="chips">
              {DOC_STATUSES.map((s) => (
                <span className="chip" key={s.slug}>{s.name}</span>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              Los estatus son fijos para mantener la consistencia entre dispositivos: Por responder, En proceso, Respondido y Solo archivo.
            </p>
          </div>
        </>
      )}

      {tab === "datos" && (
        <>
          <div className="card">
            <h2>Estado de la sincronizacion</h2>
            <dl className="kv">
              <dt>Backend</dt>
              <dd>
                {backend === "neon" ? (
                  <span className="badge ok"><Icon name="cloud" size={12} /> Neon Postgres (nube)</span>
                ) : (
                  <span className="badge warn"><Icon name="alert" size={12} /> Almacenamiento local de desarrollo</span>
                )}
              </dd>
              <dt>Estado</dt>
              <dd>
                {sync.status === "syncing" ? "Sincronizando…" : sync.status === "offline" ? "Sin conexion" : sync.status === "error" ? sync.message || "Error" : "Al día"}
              </dd>
              <dt>Ultima sincronizacion</dt>
              <dd>{sync.lastSync ? new Date(sync.lastSync).toLocaleString("es-MX") : "—"}</dd>
              <dt>Por subir</dt>
              <dd>{sync.pending} cambio(s) en la cola de este dispositivo</dd>
              <dt>Documentos</dt>
              <dd>{docs.length} en este dispositivo</dd>
              <dt>Marca de sincronizacion</dt>
              <dd className="mono">{sinceMark}</dd>
            </dl>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={onSync}><Icon name="refresh" size={14} /> Sincronizar ahora</button>
            </div>
            {backend !== "neon" && (
              <div className="notice warn" style={{ marginTop: 12 }}>
                Estás en modo local: los datos viven solo en este equipo. Para tener la misma informacion en PC y movil,
                configura <span className="mono">DATABASE_URL</span> con tu base Neon y vuelve a desplegar.
              </div>
            )}
          </div>

          <div className="card">
            <h2>Respaldo manual</h2>
            <p className="hint" style={{ marginTop: -6 }}>
              Exporta todo el archivo (documentos, textos extraidos, parametros y ajustes) en un solo JSON, o importalo en otro dispositivo.
            </p>
            <div className="row">
              <button className="btn" onClick={exportBackup}><Icon name="download" size={14} /> Exportar respaldo</button>
              <label className="btn" style={{ cursor: "pointer" }}>
                <Icon name="upload" size={14} /> Importar respaldo
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importBackup(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {busy && <div className="hint" style={{ marginTop: 8 }}>Procesando…</div>}
          </div>

          <div className="card">
            <h2>Instalacion como aplicacion</h2>
            <ol className="bullets">
              <li>En el movil: abre la app en Chrome o Safari y usa "Agregar a pantalla de inicio".</li>
              <li>En PC: usa el icono de instalacion en la barra de direcciones del navegador.</li>
              <li>Funciona sin conexion: lo que captures se guardara en el dispositivo y se subira al recuperar la red.</li>
            </ol>
          </div>
        </>
      )}
    </>
  );

}
