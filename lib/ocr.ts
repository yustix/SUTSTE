"use client";

/**
 * OCR en el navegador con Tesseract.js.
 *
 * Todo está autoalojado en /public/ocr (worker, núcleo WASM y datos de idioma),
 * así que no depende de ningún CDN y funciona en redes restringidas.
 *
 * Flujo: PDF escaneado -> pdf.js lo dibuja en un canvas -> Tesseract lee la imagen
 * -> texto -> motor de resumen habitual.
 */

type ProgressFn = (info: { status: string; progress: number; page?: number; pages?: number }) => void;

let workerPromise: Promise<any> | null = null;
let workerLangs = "";

export const OCR_LANGS = [
  { code: "spa", label: "Español" },
  { code: "spa+eng", label: "Español e inglés" },
  { code: "eng", label: "Inglés" },
];

export const OCR_LIMITS = {
  defaultPages: 5,
  maxPages: 30,
  minCharsPerPage: 8,
};

export function isOcrSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof document !== "undefined" &&
    Boolean(document.createElement("canvas").getContext)
  );
}

async function getWorker(langs: string, onProgress?: ProgressFn): Promise<any> {
  if (workerPromise && workerLangs === langs) return workerPromise;
  if (workerPromise && workerLangs !== langs) {
    await terminateOcr();
  }
  workerLangs = langs;
  workerPromise = (async () => {
    const modulo: any = await import("tesseract.js");
    const createWorker = modulo.createWorker || modulo.default?.createWorker;
    if (typeof createWorker !== "function") throw new Error("No se pudo cargar el motor OCR.");
    return createWorker(langs, 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      gzip: true,
      workerBlobURL: false,
      logger: (m: any) => {
        if (!onProgress || !m) return;
        onProgress({
          status: traducirEstado(String(m.status || "")),
          progress: Number(m.progress) || 0,
        });
      },
    });
  })();
  return workerPromise;
}

function traducirEstado(s: string): string {
  const map: Record<string, string> = {
    "loading tesseract core": "cargando el motor OCR",
    "initializing tesseract": "iniciando el motor OCR",
    "loading language traineddata": "descargando el modelo de idioma",
    "initializing api": "preparando el reconocimiento",
    "recognizing text": "leyendo el texto",
  };
  return map[s] || s;
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } catch {
    /* el worker ya no existía */
  }
  workerPromise = null;
  workerLangs = "";
}

/** OCR sobre una imagen (File, Blob, dataURL, canvas o ImageData). */
export async function ocrImage(
  image: Blob | string | HTMLCanvasElement | ImageData,
  opts: { langs?: string; onProgress?: ProgressFn } = {},
): Promise<{ text: string; confidence: number }> {
  if (!isOcrSupported()) throw new Error("Este navegador no soporta OCR.");
  const worker = await getWorker(opts.langs || "spa", opts.onProgress);
  const { data } = await worker.recognize(image as never);
  return {
    text: String(data?.text || ""),
    confidence: Number(data?.confidence) || 0,
  };
}

let pdfjsPromise: Promise<any> | null = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.toString();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export interface PdfOcrOptions {
  langs?: string;
  maxPages?: number;
  scale?: number;
  onProgress?: ProgressFn;
  signal?: { cancelled: boolean };
}

/** OCR de un PDF escaneado, página por página, liberando memoria entre páginas. */
export async function ocrPdf(file: File | Blob, opts: PdfOcrOptions = {}): Promise<{ text: string; pages: number; confidence: number }> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await (file as Blob).arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const total = doc.numPages;
  const maxPages = Math.min(opts.maxPages ?? OCR_LIMITS.defaultPages, total, OCR_LIMITS.maxPages);
  const scale = opts.scale ?? 2;
  const langs = opts.langs || "spa";

  const worker = await getWorker(langs, opts.onProgress);
  const partes: string[] = [];
  let sumaConfianza = 0;
  let leidas = 0;

  for (let p = 1; p <= maxPages; p++) {
    if (opts.signal?.cancelled) break;
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No se pudo preparar el lienzo para el OCR.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport } as never).promise;

    const { data: result } = await worker.recognize(canvas as never);
    const texto = String(result?.text || "").trim();
    if (texto.length >= OCR_LIMITS.minCharsPerPage) {
      partes.push(`[PAGINA ${p}]\n${texto}`);
      sumaConfianza += Number(result?.confidence) || 0;
      leidas += 1;
    }

    opts.onProgress?.({
      status: `leyendo el texto (página ${p} de ${maxPages})`,
      progress: p / maxPages,
      page: p,
      pages: maxPages,
    });

    canvas.width = 0;
    canvas.height = 0;
    page.cleanup?.();
  }

  await doc.destroy?.();
  return {
    text: partes.join("\n\n"),
    pages: total,
    confidence: leidas ? Math.round(sumaConfianza / leidas) : 0,
  };
}

/** OCR de un archivo: PDF o imagen. */
export async function ocrFile(
  file: File,
  opts: PdfOcrOptions = {},
): Promise<{ text: string; pages: number; confidence: number; kind: "pdf" | "imagen" }> {
  const esPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (esPdf) {
    const r = await ocrPdf(file, opts);
    return { ...r, kind: "pdf" };
  }
  const r = await ocrImage(file, { langs: opts.langs, onProgress: opts.onProgress });
  return { text: r.text, pages: 1, confidence: Math.round(r.confidence), kind: "imagen" };
}
