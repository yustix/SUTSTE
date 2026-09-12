"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { PriorityBadge, StatusBadge } from "./DocsView";
import { analyzeText, classify, daysUntil, formatMX } from "@/lib/summary-engine";
import { OCR_LANGS, OCR_LIMITS, isOcrSupported, ocrFile } from "@/lib/ocr";
import { buildResponseDraft } from "@/lib/response-template";
import type { LocalParam } from "@/lib/localdb";
import type { DocRecord } from "@/lib/schema-defs";
import { DOC_STATUSES, PRIORITIES } from "@/lib/schema-defs";
import type { AppSettings } from "./AppShell";

interface Props {
  doc: DocRecord | null;
  params: LocalParam[];
  settings: AppSettings;
  onBack: () => void;
  onSave: (doc: DocRecord) => Promise<void>;
  onDelete: (doc: DocRecord) => Promise<void>;
  notify: (msg: string) => void;
}

type Tab = "resumen" | "datos" | "texto" | "respuesta";

export function DocView({ doc, params, settings, onBack, onSave, onDelete, notify }: Props) {
  const [tab, setTab] = useState<Tab>("resumen");
  const [draft, setDraft] = useState<DocRecord | null>(doc);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState({ label: "", pct: 0 });
  const [ocrLangs, setOcrLangs] = useState("spa");
  const [ocrPages, setOcrPages] = useState(OCR_LIMITS.defaultPages);

  useEffect(() => {
    setDraft(doc);
    setDirty(false);
    setTab("resumen");
  }, [doc?.id, doc?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (kind: string, slug: string) => params.find((p) => p.kind === kind && p.slug === slug)?.name || slug || "—";
  const entities = useMemo(() => (draft?.entities || {}) as Record<string, any>, [draft]);
  const engineIsOcr = entities.engine === "ocr";
  const ocrConfidence = Number(entities.ocr?.confidence) || 0;
  const signals: string[] = Array.isArray(entities.signals) ? entities.signals : [];

  if (!doc || !draft) {
    return (
      <>
        <button className="btn ghost" onClick={onBack}><Icon name="arrowLeft" size={14} /> Volver</button>
        <div className="card empty" style={{ marginTop: 14 }}>
          <div className="big">Documento no encontrado</div>
          <div>Puede que se haya eliminado o que aun no se sincronice en este dispositivo.</div>
        </div>
      </>
    );
  }

  function patch(p: Partial<DocRecord>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await onSave(draft);
      setDirty(false);
    } finally {
      setBusy(false);
    }
  }

  async function reanalyze() {
    if (!draft) return;
    setReanalyzing(true);
    try {
      const a = analyzeText(draft.text_content || "", { fileName: draft.file_name });
      const c = classify(draft.text_content || "", a, params, {
        typeToFolder: settings.typeToFolder,
        defaultArea: settings.defaultArea,
      });
      const next: DocRecord = {
        ...draft,
        summary: a.summary,
        key_points: a.keyPoints,
        needs_response: a.needsResponse,
        response_hint: a.responseHint,
        priority: a.priority,
        confidence: c.confidence,
        doc_type: c.docType,
        folder: c.folder,
        area: c.area,
        status: c.status,
        due_on: a.dueDate || draft.due_on,
        doc_date: a.docDate || draft.doc_date,
        sender: a.entities.remitente || draft.sender,
        recipient: a.entities.destinatario || draft.recipient,
        doc_number: a.entities.folios[0] || draft.doc_number,
        entities: {
          ...(draft.entities as object),
          folios: a.entities.folios,
          amounts: a.entities.amounts,
          people: a.entities.people,
          organizations: a.entities.organizations,
          emails: a.entities.emails,
          phones: a.entities.phones,
          deadlineText: a.entities.deadlineText,
          words: a.wordCount,
          confidence: a.confidence,
          signals: a.responseSignals,
        },
      };
      setDraft(next);
      setDirty(true);
      notify("Análisis regenerado. Revisa y guarda los cambios.");
    } finally {
      setReanalyzing(false);
    }
  }

  async function runOcr() {
    if (!draft || !draft.file_url) {
      notify("No hay archivo original guardado para leer con OCR");
      return;
    }
    setOcrBusy(true);
    setOcrProgress({ label: "Descargando el archivo…", pct: 5 });
    try {
      const res = await fetch(draft.file_url);
      if (!res.ok) throw new Error(`No se pudo descargar el archivo (${res.status})`);
      const blob = await res.blob();
      const file = new File([blob], draft.file_name || "documento", { type: draft.mime_type || blob.type });
      const r = await ocrFile(file, {
        langs: ocrLangs,
        maxPages: ocrPages,
        onProgress: (info) =>
          setOcrProgress({
            label: `${info.status}${info.pages ? ` (${info.page}/${info.pages})` : ""}`,
            pct: 10 + Math.round(info.progress * 85),
          }),
      });
      if (!r.text.trim()) {
        notify("El OCR no encontró texto legible en el documento");
        return;
      }
      const a = analyzeText(r.text, { fileName: draft.file_name });
      const c = classify(r.text, a, params, {
        typeToFolder: settings.typeToFolder,
        defaultArea: settings.defaultArea,
      });
      const next: DocRecord = {
        ...draft,
        text_content: r.text.slice(0, 400000),
        summary: a.summary,
        key_points: a.keyPoints,
        needs_response: a.needsResponse,
        response_hint: a.responseHint,
        priority: a.priority,
        confidence: c.confidence,
        doc_type: c.docType || draft.doc_type,
        folder: c.folder || draft.folder,
        area: c.area || draft.area,
        status: c.status || draft.status,
        due_on: a.dueDate || draft.due_on,
        doc_date: a.docDate || draft.doc_date,
        sender: a.entities.remitente || draft.sender,
        recipient: a.entities.destinatario || draft.recipient,
        doc_number: a.entities.folios[0] || draft.doc_number,
        entities: {
          ...(draft.entities as object),
          pages: r.pages,
          words: a.wordCount,
          confidence: a.confidence,
          signals: a.responseSignals,
          engine: "ocr",
          ocr: { confidence: r.confidence, pages: r.pages, langs: ocrLangs },
        },
      };
      setDraft(next);
      setDirty(true);
      setTab("resumen");
      notify(`OCR completado con ${r.confidence}% de confianza. Revisa y guarda.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "El OCR falló");
    } finally {
      setOcrBusy(false);
      setOcrProgress({ label: "", pct: 0 });
    }
  }

  function makeDraftResponse() {
    if (!draft) return;
    patch({
      response_draft: buildResponseDraft(draft, settings.org),
      status: draft.status === "archivado" ? "en_proceso" : draft.status,
    });
    setTab("respuesta");
  }

  const days = daysUntil(draft.due_on);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <button className="btn ghost sm" onClick={onBack}><Icon name="arrowLeft" size={14} /> Archivo</button>
        <div className="row">
          {dirty && <span className="badge warn">Cambios sin guardar</span>}
          <button className="btn sm" onClick={reanalyze} disabled={reanalyzing || !draft.text_content}>
            {reanalyzing ? <span className="spin dark" /> : <Icon name="refresh" size={14} />} Volver a analizar
          </button>
          <button className="btn primary sm" onClick={save} disabled={busy || !dirty}>
            {busy ? <span className="spin" /> : <Icon name="save" size={14} />} Guardar
          </button>
        </div>
      </div>

      <h1 className="page-title" style={{ marginTop: 10 }}>{draft.title || draft.file_name}</h1>
      <div className="chips" style={{ marginBottom: 6 }}>
        <span className="chip"><span className="folder-dot" style={{ background: "var(--blue-600)" }} />{nameOf("carpeta", draft.folder)}</span>
        <span className="chip">{nameOf("tipo", draft.doc_type)}</span>
        <span className="chip">{nameOf("area", draft.area)}</span>
        <PriorityBadge p={draft.priority} />
        <StatusBadge s={draft.status} needs={draft.needs_response} />
        {draft.due_on && (
          <span className={`badge ${days !== null && days < 0 ? "alert" : days !== null && days <= 7 ? "warn" : "muted"}`}>
            <Icon name="clock" size={12} />
            {days !== null && days < 0 ? `Vencio hace ${Math.abs(days)} días` : `Límite en ${days} días`}
          </span>
        )}
      </div>
      <p className="page-sub">
        {draft.file_name} · {(draft.size_bytes / 1024).toFixed(0)} KB · recibido el {formatMX(draft.received_on)}
      </p>

      <div className="tabs">
        {(["resumen", "datos", "texto", "respuesta"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "resumen" ? "Resumen" : t === "datos" ? "Datos de archivo" : t === "texto" ? "Texto extraido" : "Respuesta"}
          </button>
        ))}
      </div>

      {tab === "resumen" && (
        <>
          <div className="card">
            <h2>Informacion relevante</h2>
            <textarea
              className="textarea summary-text"
              value={draft.summary}
              onChange={(e) => patch({ summary: e.target.value })}
              style={{ minHeight: 130 }}
            />
            <h2 style={{ marginTop: 18 }}>Puntos clave</h2>
            <ul className="bullets">
              {draft.key_points.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
              {!draft.key_points.length && <li className="muted">Sin puntos clave.</li>}
            </ul>
          </div>

          <div className="card">
            <h2>Respuesta sugerida por el sistema</h2>
            <div className="row">
              <span className={`badge ${draft.needs_response ? "alert" : "muted"}`}>
                <Icon name={draft.needs_response ? "reply" : "check"} size={13} />
                {draft.needs_response ? "Requiere respuesta" : "Solo archivar"}
              </span>
              <label className="row" style={{ gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={draft.needs_response}
                  onChange={(e) =>
                    patch({ needs_response: e.target.checked, status: e.target.checked ? "por_responder" : "archivado" })
                  }
                />
                Requiere respuesta
              </label>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--text-2)" }}>{draft.response_hint}</p>
            {signals.length > 0 && (
              <ul className="bullets">
                {signals.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
            {draft.needs_response && !draft.response_draft && (
              <button className="btn primary" style={{ marginTop: 10 }} onClick={makeDraftResponse}>
                <Icon name="edit" size={14} /> Generar borrador de respuesta
              </button>
            )}
          </div>

          <div className="card">
            <h2>Datos detectados</h2>
            <dl className="kv">
              <dt>Remitente</dt><dd>{draft.sender || "—"}</dd>
              <dt>Dirigido a</dt><dd>{draft.recipient || "—"}</dd>
              <dt>Folio</dt><dd>{draft.doc_number || "—"}</dd>
              <dt>Fecha documento</dt><dd>{formatMX(draft.doc_date) || "—"}</dd>
              <dt>Fecha limite</dt><dd>{formatMX(draft.due_on) || "—"}</dd>
              <dt>Montos</dt>
              <dd>
                {Array.isArray(entities.amounts) && entities.amounts.length
                  ? entities.amounts.map((a: any) => `$${Number(a.value).toLocaleString("es-MX")}`).join(", ")
                  : "—"}
              </dd>
              <dt>Personas</dt>
              <dd>{Array.isArray(entities.people) && entities.people.length ? entities.people.join(", ") : "—"}</dd>
              <dt>Instituciones</dt>
              <dd>{Array.isArray(entities.organizations) && entities.organizations.length ? entities.organizations.join(" | ") : "—"}</dd>
              <dt>Contacto</dt>
              <dd>
                {Array.isArray(entities.emails) && entities.emails.length ? entities.emails.join(", ") : "—"}
                {Array.isArray(entities.phones) && entities.phones.length ? ` · ${entities.phones.join(", ")}` : ""}
              </dd>
              <dt>Palabras</dt><dd>{entities.words ?? "—"}</dd>
              <dt>Confianza</dt><dd>{Math.round((draft.confidence || 0) * 100)}%</dd>
            </dl>
          </div>

          <div className="card">
            <h2>Archivo original</h2>
            {draft.file_url ? (
              <a className="btn" href={draft.file_url} target="_blank" rel="noreferrer">
                <Icon name="download" size={14} /> Abrir o descargar
              </a>
            ) : (
              <div className="notice warn">
                El archivo original no se subio. El analisis y los metadatos si quedaron guardados; puedes volver a subirlo desde otro documento.
              </div>
            )}
          </div>
        </>
      )}

      {tab === "datos" && (
        <div className="card">
          <h2>Clasificacion y seguimiento</h2>
          <div className="grid cols-2">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Titulo</label>
              <input className="input" value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
            </div>
            <div className="field">
              <label>Tipo de documento</label>
              <select className="select" value={draft.doc_type} onChange={(e) => patch({ doc_type: e.target.value })}>
                {params.filter((p) => p.kind === "tipo").map((t) => (
                  <option key={t.id} value={t.slug}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Carpeta</label>
              <select className="select" value={draft.folder} onChange={(e) => patch({ folder: e.target.value })}>
                {params.filter((p) => p.kind === "carpeta").map((c) => (
                  <option key={c.id} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Area</label>
              <select className="select" value={draft.area} onChange={(e) => patch({ area: e.target.value })}>
                {params.filter((p) => p.kind === "area").map((a) => (
                  <option key={a.id} value={a.slug}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Prioridad</label>
              <select className="select" value={draft.priority} onChange={(e) => patch({ priority: e.target.value })}>
                <option value="">Sin asignar</option>
                {PRIORITIES.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Estatus</label>
              <select className="select" value={draft.status} onChange={(e) => patch({ status: e.target.value })}>
                {DOC_STATUSES.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Folio u oficio</label>
              <input className="input" value={draft.doc_number} onChange={(e) => patch({ doc_number: e.target.value })} />
            </div>
            <div className="field">
              <label>Remitente</label>
              <input className="input" value={draft.sender} onChange={(e) => patch({ sender: e.target.value })} />
            </div>
            <div className="field">
              <label>Dirigido a</label>
              <input className="input" value={draft.recipient} onChange={(e) => patch({ recipient: e.target.value })} />
            </div>
            <div className="field">
              <label>Fecha del documento</label>
              <input type="date" className="input" value={draft.doc_date || ""} onChange={(e) => patch({ doc_date: e.target.value || null })} />
            </div>
            <div className="field">
              <label>Fecha de recepcion</label>
              <input type="date" className="input" value={draft.received_on || ""} onChange={(e) => patch({ received_on: e.target.value || null })} />
            </div>
            <div className="field">
              <label>Fecha limite</label>
              <input type="date" className="input" value={draft.due_on || ""} onChange={(e) => patch({ due_on: e.target.value || null })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Notas internas</label>
              <textarea className="textarea" value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
            </div>
          </div>

          <div className="row" style={{ marginTop: 16, justifyContent: "space-between" }}>
            <button className="btn" onClick={save} disabled={!dirty || busy}>
              <Icon name="save" size={14} /> Guardar cambios
            </button>
            <div>
              {confirmDelete ? (
                <span className="row">
                  <span className="hint">Confirmar eliminacion</span>
                  <button className="btn danger sm" onClick={() => onDelete(draft)}><Icon name="trash" size={13} /> Eliminar</button>
                  <button className="btn ghost sm" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                </span>
              ) : (
                <button className="btn danger ghost sm" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={13} /> Eliminar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "texto" && (
        <div className="card">
          <h2>Texto extraido</h2>
          {draft.text_content ? (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <button
                  className="btn sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(draft.text_content);
                      notify("Texto copiado al portapapeles");
                    } catch {
                      notify("El navegador bloqueo el portapapeles");
                    }
                  }}
                >
                  <Icon name="doc" size={13} /> Copiar todo
                </button>
                <span className="hint">{draft.text_content.length.toLocaleString("es-MX")} caracteres</span>
              </div>
              <pre
                className="mono"
                style={{ whiteSpace: "pre-wrap", maxHeight: "60vh", overflow: "auto", background: "var(--blue-50)", padding: 12, borderRadius: 8 }}
              >
                {draft.text_content}
              </pre>
            </>
          ) : (
            <>
              <div className="notice warn">
                Este documento no tiene texto extraído: probablemente es un PDF escaneado o una imagen
                sin capa de texto. Puedes leerlo con reconocimiento óptico (OCR) directamente aquí.
              </div>

              {!draft.file_url ? (
                <div className="notice err" style={{ marginTop: 12 }}>
                  No se guardó el archivo original, así que no hay nada que leer. Vuelve a subir el documento.
                </div>
              ) : !isOcrSupported() ? (
                <div className="notice err" style={{ marginTop: 12 }}>
                  Este navegador no puede ejecutar el OCR.
                </div>
              ) : (
                <div className="card" style={{ marginTop: 14, boxShadow: "none" }}>
                  <h2>Leer con OCR</h2>
                  <div className="grid cols-2">
                    <div className="field">
                      <label>Idioma del documento</label>
                      <select className="select" value={ocrLangs} onChange={(e) => setOcrLangs(e.target.value)} disabled={ocrBusy}>
                        {OCR_LANGS.map((l) => (
                          <option key={l.code} value={l.code}>{l.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Páginas a leer como máximo</label>
                      <select className="select" value={ocrPages} onChange={(e) => setOcrPages(Number(e.target.value))} disabled={ocrBusy}>
                        {[1, 3, 5, 10, 20, 30].map((n) => (
                          <option key={n} value={n}>{n} página{n === 1 ? "" : "s"}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn primary" onClick={runOcr} disabled={ocrBusy}>
                      {ocrBusy ? <span className="spin" /> : <Icon name="search" size={14} />}
                      {ocrBusy ? "Procesando…" : "Ejecutar OCR"}
                    </button>
                    <span className="hint">Tarda entre 2 y 6 segundos por página.</span>
                  </div>
                  {ocrBusy && (
                    <>
                      <div className="progress" style={{ marginTop: 12 }}>
                        <i style={{ width: `${ocrProgress.pct}%` }} />
                      </div>
                      <div className="hint" style={{ marginTop: 6 }}>{ocrProgress.label} · {ocrProgress.pct}%</div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "respuesta" && (
        <div className="card">
          <h2>Borrador de respuesta</h2>
          {!draft.response_draft && (
            <p className="hint" style={{ marginBottom: 10 }}>
              Genera una plantilla con los datos detectados (destinatario, folio, fechas). Despues la editas con tu propia redaccion.
            </p>
          )}
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn primary sm" onClick={makeDraftResponse}>
              <Icon name="edit" size={14} /> {draft.response_draft ? "Regenerar plantilla" : "Generar borrador"}
            </button>
            {draft.response_draft && (
              <>
                <button
                  className="btn sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(draft.response_draft);
                      notify("Borrador copiado");
                    } catch {
                      notify("El navegador bloqueo el portapapeles");
                    }
                  }}
                >
                  <Icon name="doc" size={13} /> Copiar
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    const blob = new Blob([draft.response_draft], { type: "text/plain;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `respuesta-${(draft.doc_number || draft.id).replace(/[^\w.-]+/g, "-")}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Icon name="download" size={13} /> Descargar .txt
                </button>
                <button
                  className="btn sm"
                  onClick={() => patch({ status: "respondido", response_sent_at: new Date().toISOString() })}
                >
                  <Icon name="check" size={13} /> Marcar como respondido
                </button>
              </>
            )}
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 380, fontFamily: "var(--mono)", fontSize: 13 }}
            value={draft.response_draft}
            onChange={(e) => patch({ response_draft: e.target.value })}
            placeholder="Aquí va la redacción de tu respuesta…"
          />
          {draft.response_sent_at && (
            <div className="notice ok" style={{ marginTop: 10 }}>
              Marcado como respondido el {formatMX(draft.response_sent_at.slice(0, 10))}.
            </div>
          )}
        </div>
      )}
    </>
  );
}
