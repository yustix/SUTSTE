"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { ingestDocument, supportsOcr, type IngestResult } from "@/lib/pipeline";
import { OCR_LANGS, OCR_LIMITS, isOcrSupported } from "@/lib/ocr";
import { buildResponseDraft } from "@/lib/response-template";
import { formatMX } from "@/lib/summary-engine";
import type { LocalParam } from "@/lib/localdb";
import type { DocRecord } from "@/lib/schema-defs";
import { DOC_STATUSES, PRIORITIES } from "@/lib/schema-defs";
import type { AppSettings } from "./AppShell";

interface Props {
  params: LocalParam[];
  settings: AppSettings;
  saveDoc: (doc: DocRecord) => Promise<DocRecord>;
  onSaved: (doc: DocRecord) => void;
  onCancel: () => void;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.html,.json,application/pdf";

export function UploadView({ params, settings, saveDoc, onSaved, onCancel }: Props) {
  const [step, setStep] = useState<"pick" | "working" | "review">("pick");
  const [progress, setProgress] = useState({ label: "", pct: 0 });
  const [result, setResult] = useState<IngestResult | null>(null);
  const [draft, setDraft] = useState<DocRecord | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [ocrLangs, setOcrLangs] = useState("spa");
  const [ocrPages, setOcrPages] = useState(OCR_LIMITS.defaultPages);
  const ocrDisponible = isOcrSupported();
  const inputRef = useRef<HTMLInputElement>(null);

  const tipos = params.filter((p) => p.kind === "tipo");
  const carpetas = params.filter((p) => p.kind === "carpeta");
  const areas = params.filter((p) => p.kind === "area");

  useEffect(() => {
    async function handlePaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.files || []);
      if (items.length) await run(items[0]);
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, settings]);

  async function run(file: File) {
    setError("");
    if (file.size > 40 * 1024 * 1024) {
      setError("El archivo supera los 40 MB.");
      return;
    }
    setStep("working");
    setProgress({ label: "Preparando…", pct: 5 });
    try {
      const res = await ingestDocument({
        file,
        params,
        typeToFolder: settings.typeToFolder,
        defaultArea: settings.defaultArea,
        onProgress: (label, pct) => setProgress({ label, pct }),
        ocr: ocrEnabled,
        ocrLangs,
        ocrMaxPages: ocrPages,
      });
      setResult(res);
      setDraft(res.doc);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el archivo.");
      setStep("pick");
    }
  }

  async function save(withDraftResponse = false) {
    if (!draft) return;
    setSaving(true);
    try {
      const final: DocRecord = {
        ...draft,
        response_draft: withDraftResponse && !draft.response_draft ? buildResponseDraft(draft, settings.org) : draft.response_draft,
      };
      const saved = await saveDoc(final);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  function patch(p: Partial<DocRecord>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  /* ------------------------- seleccion de archivo ------------------------- */
  if (step === "pick" || step === "working") {
    return (
      <>
        <h1 className="page-title">Nuevo documento</h1>
        <p className="page-sub">
          Sube un PDF, Word o texto. El resumen y la clasificacion se generan en tu equipo; el archivo se guarda en tu almacenamiento.
        </p>

        <div
          className={`dropzone ${drag ? "over" : ""}`}
          onClick={() => step === "pick" && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void run(f);
          }}
          style={step === "working" ? { cursor: "default" } : undefined}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void run(f);
              e.target.value = "";
            }}
          />
          {step === "pick" ? (
            <>
              <div style={{ display: "flex", justifyContent: "center", color: "var(--blue-700)", marginBottom: 8 }}>
                <Icon name="upload" size={26} />
              </div>
              <div className="t">Arrastra el documento aqui o toca para seleccionar</div>
              <div className="s">PDF, DOCX, TXT, MD, CSV o HTML - hasta 40 MB</div>
              <div className="s" style={{ marginTop: 10 }}>
                Tambien puedes pegar un archivo copiado al portapapeles
              </div>
            </>
          ) : (
            <>
              <div className="t">{progress.label}</div>
              <div className="progress" style={{ marginTop: 12, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
                <i style={{ width: `${progress.pct}%` }} />
              </div>
              <div className="s" style={{ marginTop: 8 }}>{progress.pct}%</div>
            </>
          )}
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <h2>Documentos escaneados (OCR)</h2>
          {!ocrDisponible ? (
            <div className="notice warn">
              Este navegador no puede ejecutar el reconocimiento óptico de texto. Los PDF con texto
              selectable y los archivos de Word se procesan sin problema.
            </div>
          ) : (
            <>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={ocrEnabled} onChange={(e) => setOcrEnabled(e.target.checked)} />
                <span>
                  Aplicar OCR cuando el documento no tenga texto
                  <span className="hint" style={{ display: "block" }}>
                    Se ejecuta en tu equipo. La primera vez descarga el modelo de idioma (unos 2 MB) y queda
                    guardado en caché.
                  </span>
                </span>
              </label>
              {ocrEnabled && (
                <div className="grid cols-2" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label>Idioma del documento</label>
                    <select className="select" value={ocrLangs} onChange={(e) => setOcrLangs(e.target.value)}>
                      {OCR_LANGS.map((l) => (
                        <option key={l.code} value={l.code}>{l.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Páginas a leer como máximo</label>
                    <select className="select" value={ocrPages} onChange={(e) => setOcrPages(Number(e.target.value))}>
                      {[1, 3, 5, 10, 20, 30].map((n) => (
                        <option key={n} value={n}>{n} página{n === 1 ? "" : "s"}</option>
                      ))}
                    </select>
                    <span className="hint">El OCR tarda entre 2 y 6 segundos por página en un equipo normal.</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {error && <div className="notice err" style={{ marginTop: 14 }}>{error}</div>}

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn ghost" onClick={onCancel}>
            <Icon name="arrowLeft" size={14} /> Volver al archivo
          </button>
        </div>

        <div className="card" style={{ marginTop: 18 }}>
          <h2>Como se procesa</h2>
          <ol className="bullets">
            <li>Se extrae el texto del documento directamente en tu navegador.</li>
            <li>Si es un escaneo sin texto, se aplica reconocimiento óptico (OCR) con Tesseract.</li>
            <li>Se generan resumen, puntos clave, fechas, montos, folios y personas mencionadas.</li>
            <li>Se clasifica el tipo de documento, la carpeta y el area segun tus parametros.</li>
            <li>Se evalua si requiere respuesta, con que prioridad y para cuando.</li>
            <li>Revisas, corriges lo que haga falta y guardas. Queda archivado y sincronizado.</li>
          </ol>
        </div>
      </>
    );
  }

  /* ------------------------------ revision -------------------------------- */
  if (!draft || !result) return null;
  const { analysis, classification } = result;
  const engineRaw = (draft.entities as Record<string, unknown>)?.engine;
  const engine = engineRaw === "llm" ? "Modelo de IA" : engineRaw === "ocr" ? "OCR + motor local" : "Motor local";

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <h1 className="page-title">Revisa y archiva</h1>
        <button className="btn ghost sm" onClick={() => { setStep("pick"); setResult(null); setDraft(null); }}>
          <Icon name="refresh" size={14} /> Otro archivo
        </button>
      </div>
      <p className="page-sub">
        Sugerencia automatica con confianza del {Math.round((classification.confidence || 0) * 100)}% ({engine}). Ajusta lo que necesites antes de guardar.
      </p>

      {result.warning && <div className="notice warn" style={{ marginBottom: 14 }}>{result.warning}</div>}
      {error && <div className="notice err" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card">
        <h2>Resumen</h2>
        <textarea
          className="textarea"
          value={draft.summary}
          onChange={(e) => patch({ summary: e.target.value })}
          style={{ minHeight: 120 }}
        />
        <div className="hint" style={{ marginTop: 6 }}>
          {analysis.wordCount} palabras analizadas en {String((draft.entities as any)?.pages ?? 1)} pagina(s). Puedes editar el resumen.
        </div>

        <h2 style={{ marginTop: 18 }}>Puntos clave</h2>
        <ul className="bullets">
          {draft.key_points.map((k, i) => (
            <li key={i}>{k}</li>
          ))}
          {!draft.key_points.length && <li className="muted">Sin puntos clave detectados.</li>}
        </ul>
      </div>

      <div className="card">
        <h2>Sugerencia de respuesta</h2>
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <span className={`badge ${draft.needs_response ? "alert" : "muted"}`}>
            <Icon name={draft.needs_response ? "reply" : "check"} size={13} />
            {draft.needs_response ? "Requiere respuesta" : "Solo archivar"}
          </span>
          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={draft.needs_response}
              onChange={(e) => patch({ needs_response: e.target.checked, status: e.target.checked ? "por_responder" : "archivado" })}
            />
            Cambiar manualmente
          </label>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "10px 0 0" }}>{draft.response_hint}</p>
        {analysis.responseSignals.length > 0 && (
          <ul className="bullets" style={{ marginTop: 8 }}>
            {analysis.responseSignals.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Datos de archivo</h2>
        <div className="grid cols-2">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Titulo</label>
            <input className="input" value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
          </div>
          <div className="field">
            <label>Tipo de documento</label>
            <select className="select" value={draft.doc_type} onChange={(e) => patch({ doc_type: e.target.value })}>
              {tipos.map((t) => (
                <option key={t.id} value={t.slug}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Carpeta</label>
            <select
              className="select"
              value={draft.folder}
              onChange={(e) => patch({ folder: e.target.value })}
            >
              {carpetas.map((c) => (
                <option key={c.id} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Area</label>
            <select className="select" value={draft.area} onChange={(e) => patch({ area: e.target.value })}>
              {areas.map((a) => (
                <option key={a.id} value={a.slug}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Prioridad</label>
            <select className="select" value={draft.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name}</option>
              ))}
              {!draft.priority && <option value="">Sin asignar</option>}
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
            <label>Fecha limite de respuesta</label>
            <input type="date" className="input" value={draft.due_on || ""} onChange={(e) => patch({ due_on: e.target.value || null })} />
            {draft.due_on && <span className="hint">Detectada: {formatMX(draft.due_on)}</span>}
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Notas internas</label>
            <textarea className="textarea" value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Contexto, acuerdos previos, a quien se turno…" />
          </div>
        </div>

        {classification.matched.length > 0 && (
          <>
            <h2 style={{ marginTop: 18 }}>Por que se clasifico asi</h2>
            <ul className="bullets">
              {classification.matched.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <details className="card">
        <summary style={{ cursor: "pointer", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)", fontWeight: 600 }}>
          Texto extraido del documento
        </summary>
        <pre
          className="mono"
          style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto", background: "var(--blue-50)", padding: 12, borderRadius: 8, marginTop: 12 }}
        >
          {draft.text_content.slice(0, 20000) || "(sin texto)"}
        </pre>
      </details>

      <div className="row" style={{ marginTop: 16, position: "sticky", bottom: 0, background: "var(--bg)", padding: "12px 0" }}>
        <button className="btn primary" disabled={saving} onClick={() => save(false)}>
          {saving ? <span className="spin" /> : <Icon name="save" size={15} />} Archivar documento
        </button>
        <button className="btn" disabled={saving} onClick={() => save(true)}>
          <Icon name="reply" size={15} /> Archivar y crear borrador de respuesta
        </button>
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </>
  );
}
