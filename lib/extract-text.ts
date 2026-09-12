"use client";

/**
 * Extraccion de texto en el navegador.
 * PDF  -> pdfjs-dist
 * DOCX -> descompresion con fflate + limpieza de XML
 * TXT / MD / CSV / HTML / JSON -> decodificacion directa
 *
 * Todo ocurre en el cliente: el documento nunca viaja crudo al servidor,
 * lo que evita el limite de tamano de las Serverless Functions.
 */

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

export interface ExtractionResult {
  text: string;
  pages: number;
  warning?: string;
}

export async function extractText(file: File): Promise<ExtractionResult> {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();

  if (type === "application/pdf" || name.endsWith(".pdf")) return extractPdf(file);
  if (
    name.endsWith(".docx") ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return extractDocx(file);
  if (name.endsWith(".doc")) {
    return {
      text: "",
      pages: 0,
      warning:
        "Formato .doc antiguo no soportado. Guardalo como .docx o PDF desde Word y vuelve a subirlo.",
    };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return {
      text: "",
      pages: 0,
      warning: "Las hojas de calculo requieren un convertidor adicional. Exporta a PDF para analizarla.",
    };
  }
  if (type.startsWith("image/")) {
    return {
      text: "",
      pages: 0,
      warning:
        "Es una imagen. Para leerla se necesita OCR; por ahora captura el texto o convierte la imagen a PDF con texto.",
    };
  }
  // texto plano y derivados
  const text = await file.text();
  if (name.endsWith(".html") || name.endsWith(".htm")) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    doc.querySelectorAll("script,style").forEach((n) => n.remove());
    return { text: doc.body?.textContent || "", pages: 1 };
  }
  return { text, pages: 1 };
}

async function extractPdf(file: File): Promise<ExtractionResult> {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
  const maxPages = Math.min(doc.numPages, 120);
  const parts: string[] = [];
  let warning: string | undefined;

  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line = "";
    const pageLines: string[] = [];
    for (const item of content.items as any[]) {
      if (typeof item.str !== "string") continue;
      const y = item.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        pageLines.push(line);
        line = "";
      }
      line += item.str + (item.hasEOL ? "\n" : " ");
      if (item.hasEOL) {
        pageLines.push(line);
        line = "";
      }
      lastY = y;
    }
    if (line) pageLines.push(line);
    parts.push(`\n[PAGINA ${p}]\n` + pageLines.join("\n"));
    page.cleanup?.();
  }

  const text = parts.join("\n").replace(/\n{3,}/g, "\n\n");
  if (!text.trim()) {
    warning =
      "El PDF no contiene texto seleccionable (probablemente es un escaneo). Se guardara el archivo, pero el resumen requiere OCR o una version con texto.";
  } else if (doc.numPages > maxPages) {
    warning = `Documento de ${doc.numPages} paginas: se analizaron las primeras ${maxPages}.`;
  }
  await doc.destroy?.();
  return { text, pages: doc.numPages, warning };
}

async function extractDocx(file: File): Promise<ExtractionResult> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const buf = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buf);
  } catch {
    return { text: "", pages: 0, warning: "El archivo .docx esta danado o protegido con contrasena." };
  }

  const order = ["word/document.xml"];
  Object.keys(entries)
    .filter((k) => /^word\/(header|footer)\d*\.xml$/.test(k))
    .sort()
    .forEach((k) => order.push(k));

  const chunks: string[] = [];
  for (const key of order) {
    const data = entries[key];
    if (!data) continue;
    chunks.push(xmlToText(strFromU8(data)));
  }
  const text = chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) {
    return { text: "", pages: 0, warning: "No se encontro texto en el documento de Word." };
  }
  return { text, pages: Math.max(1, Math.round(text.split(/\s+/).length / 450)) };
}

function xmlToText(xml: string): string {
  let s = xml
    .replace(/<w:tab[^>]*\/?>/gi, "\t")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<w:br[^>]*\/?>/gi, "\n")
    .replace(/<w:cr[^>]*\/?>/gi, "\n")
    .replace(/<w:noBreakHyphen[^>]*\/?>/gi, "-")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(s);
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
