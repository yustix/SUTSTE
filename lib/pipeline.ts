"use client";

import { extractText } from "./extract-text";
import { OCR_LIMITS, isOcrSupported, ocrFile } from "./ocr";
import { analyzeText, classify, type ParamLike, type SummaryResult } from "./summary-engine";
import { uploadFile } from "./upload";
import { slugify } from "./util";
import type { DocRecord } from "./schema-defs";

export interface IngestResult {
  doc: DocRecord;
  analysis: SummaryResult;
  classification: ReturnType<typeof classify>;
  warning?: string;
}

export interface IngestOptions {
  file: File;
  receivedOn?: string | null;
  params: ParamLike[];
  typeToFolder?: Record<string, string>;
  defaultArea?: string;
  onProgress?: (step: string, pct: number) => void;
  ocr?: boolean;
  ocrLangs?: string;
  ocrMaxPages?: number;
}

/** Archivos que solo se pueden leer con OCR. */
export function supportsOcr(file: File): boolean {
  const n = file.name.toLowerCase();
  return (
    file.type === "application/pdf" ||
    n.endsWith(".pdf") ||
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|bmp)$/i.test(n)
  );
}

const OCR_MIN_CHARS = 40;

export function newDocId(): string {
  return (
    "d_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Flujo completo de ingreso:
 * 1. extrae el texto en el navegador
 * 2. genera resumen, puntos clave y entidades
 * 3. clasifica tipo / carpeta / area segun los parametros del usuario
 * 4. decide si requiere respuesta y con que prioridad
 * 5. sube el archivo original (Vercel Blob o disco local)
 */
export async function ingestDocument(opts: IngestOptions): Promise<IngestResult> {
  const { file, params, onProgress } = opts;
  onProgress?.("Leyendo el archivo…", 10);
  const extraction = await extractText(file);

  let text = extraction.text;
  let pages = extraction.pages;
  let warning = extraction.warning;
  let ocrUsed = false;
  let ocrConfidence = 0;

  const escaneado = text.replace(/\s+/g, " ").trim().length < OCR_MIN_CHARS && supportsOcr(file);
  if (escaneado && opts.ocr && isOcrSupported()) {
    try {
      const r = await ocrFile(file, {
        langs: opts.ocrLangs || "spa",
        maxPages: opts.ocrMaxPages ?? OCR_LIMITS.defaultPages,
        onProgress: (info) =>
          onProgress?.(
            `Reconocimiento óptico de texto: ${info.status}${
              info.pages ? ` (${info.page}/${info.pages})` : ""
            }`,
            45 + Math.round(info.progress * 25),
          ),
      });
      if (r.text.trim()) {
        text = r.text;
        pages = r.pages || pages;
        ocrUsed = true;
        ocrConfidence = r.confidence;
        const limite = opts.ocrMaxPages ?? OCR_LIMITS.defaultPages;
        warning =
          `Documento sin capa de texto: se aplicó reconocimiento óptico (OCR) sobre ` +
          `${Math.min(limite, pages)} de ${pages} página(s), con una confianza de ${ocrConfidence}%. ` +
          `Revisa el resumen antes de archivar: el OCR puede equivocarse con sellos, firmas y números.`;
      } else {
        warning =
          "No se reconoció texto legible con OCR. Puede ser un escaneo de baja calidad, un documento " +
          "manuscrito o una página en blanco. El archivo quedó guardado de todos modos.";
      }
    } catch (e) {
      warning = `${warning ? warning + " " : ""}El OCR falló: ${
        e instanceof Error ? e.message : "error desconocido"
      }. El archivo se guardó sin texto.`;
    }
  } else if (escaneado && !isOcrSupported()) {
    warning = "Es un documento escaneado y este navegador no permite ejecutar el OCR.";
  }

  onProgress?.("Analizando contenido…", 72);
  const analysis = analyzeText(text, { fileName: file.name });
  const classification = classify(text, analysis, params, {
    typeToFolder: opts.typeToFolder,
    defaultArea: opts.defaultArea,
  });

  const title =
    (analysis.entities.asunto || "").trim() ||
    file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ||
    "Documento sin título";

  onProgress?.("Guardando el archivo…", 70);
  let fileUrl: string | null = null;
  let fileKey: string | null = null;
  try {
    const stored = await uploadFile(file, onProgress);
    fileUrl = stored.url;
    fileKey = stored.key;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    warning = `${warning ? warning + " " : ""}El análisis se completó, pero el archivo no se pudo subir (${msg}). Se reintentará al sincronizar.`;
  }

  onProgress?.("Listo", 100);

  const now = new Date().toISOString();
  const doc: DocRecord = {
    id: newDocId(),
    owner_id: "",
    title: title.slice(0, 180),
    file_name: file.name,
    mime_type: file.type || "",
    size_bytes: file.size,
    file_url: fileUrl,
    file_key: fileKey,
    text_content: text.slice(0, 400000),
    summary: analysis.summary,
    key_points: analysis.keyPoints,
    entities: {
      folios: analysis.entities.folios,
      dates: analysis.entities.dates.slice(0, 8),
      amounts: analysis.entities.amounts,
      people: analysis.entities.people.slice(0, 6),
      organizations: analysis.entities.organizations,
      emails: analysis.entities.emails,
      phones: analysis.entities.phones,
      remitente: analysis.entities.remitente,
      destinatario: analysis.entities.destinatario,
      asunto: analysis.entities.asunto,
      deadlineText: analysis.entities.deadlineText,
      pages,
      words: analysis.wordCount,
      confidence: analysis.confidence,
      signals: analysis.responseSignals,
      engine: ocrUsed ? "ocr" : "local",
      ocr: ocrUsed ? { confidence: ocrConfidence, pages } : undefined,
    },
    doc_type: classification.docType,
    folder: classification.folder,
    area: classification.area,
    priority: analysis.priority,
    status: classification.status,
    sender: analysis.entities.remitente,
    recipient: analysis.entities.destinatario,
    doc_number: analysis.entities.folios[0] || "",
    received_on: opts.receivedOn || now.slice(0, 10),
    due_on: analysis.dueDate,
    doc_date: analysis.docDate,
    needs_response: analysis.needsResponse,
    response_hint: analysis.responseHint,
    confidence: classification.confidence,
    tags: buildTags(classification, analysis),
    response_draft: "",
    response_sent_at: null,
    notes: "",
    rev: 1,
    deleted: false,
    created_at: now,
    updated_at: now,
  };

  return { doc, analysis, classification, warning };
}

function buildTags(c: ReturnType<typeof classify>, a: SummaryResult): string[] {
  const tags: string[] = [];
  if (c.docTypeName) tags.push(c.docTypeName);
  if (c.folderName) tags.push(c.folderName);
  if (a.dueDate) tags.push("Con plazo");
  if (a.entities.amounts.length) tags.push("Con montos");
  return Array.from(new Set(tags)).slice(0, 6);
}

/** Titulo sugerido a partir del contenido cuando el nombre de archivo no aporta nada. */
export function suggestTitle(doc: DocRecord): string {
  const base = doc.title || doc.file_name || "Documento";
  if (doc.doc_number && !base.includes(doc.doc_number)) return `${base} (${doc.doc_number})`;
  return base;
}

export { slugify };
