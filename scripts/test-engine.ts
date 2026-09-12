/**
 * Prueba del motor de análisis con los documentos de muestra (sin OCR).
 * Para el OCR usa: npx tsx scripts/test-ocr.ts
 * Uso: npx tsx scripts/test-engine.ts
 */
import fs from "fs";
import path from "path";
import { unzipSync, strFromU8 } from "fflate";
import { analyzeText, classify, normalizeText } from "../lib/summary-engine";
import { DEFAULT_PARAMS } from "../lib/schema-defs";

const root = path.join(process.cwd(), "muestras");

async function pdfText(buf: Uint8Array): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    out.push((content.items as any[]).map((i) => i.str + (i.hasEOL ? "\n" : " ")).join(""));
  }
  return out.join("\n");
}

function docxText(buf: Uint8Array): string {
  const entries = unzipSync(buf);
  const xml = strFromU8(entries["word/document.xml"]);
  return xml
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<w:tab[^>]*\/?>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const typeToFolder: Record<string, string> = {
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
};

async function main() {
  const soportados = /\.(pdf|docx|txt|md|csv|html?)$/i;
  for (const file of fs.readdirSync(root).sort().filter((f) => soportados.test(f))) {
    const full = path.join(root, file);
    const buf = new Uint8Array(fs.readFileSync(full));
    let text = "";
    if (file.endsWith(".pdf")) text = await pdfText(buf);
    else if (file.endsWith(".docx")) text = docxText(buf);
    else text = new TextDecoder().decode(buf);

    text = normalizeText(text);
    const a = analyzeText(text, { fileName: file });
    const c = classify(text, a, DEFAULT_PARAMS as any, { typeToFolder, defaultArea: "externo" });

    
    console.log("ARCHIVO:", file, `(${text.split(/\s+/).length} palabras)`);
    console.log("-".repeat(78));
    console.log("TIPO      :", c.docTypeName, "| CARPETA:", c.folderName, "| AREA:", c.areaName);
    console.log("ESTATUS   :", c.status, "| PRIORIDAD:", a.priority, "| CONFIANZA:", Math.round(c.confidence * 100) + "%");
    console.log("RESPUESTA :", a.needsResponse ? "SI requiere" : "NO requiere", "->", a.responseHint);
    console.log("SENALES   :", a.responseSignals.join(" / "));
    console.log("FECHAS    : doc =", a.docDate, "| limite =", a.dueDate);
    console.log("REMITE    :", a.entities.remitente, "| PARA:", a.entities.destinatario);
    console.log("FOLIO     :", a.entities.folios.join(", ") || "—");
    console.log("MONTOS    :", a.entities.amounts.map((m) => m.raw).join(" | ") || "—");
    console.log("PERSONAS  :", a.entities.people.join(", ") || "—");
    console.log("RESUMEN   :\n  " + a.summary.replace(/\n/g, "\n  "));
    console.log("CLAVES    :");
    a.keyPoints.forEach((k) => console.log("  -", k));
    console.log("RAZONES   :", c.matched.join(" | "));
  }
  

}

main().then(() => console.log("\n" + "=".repeat(78))).catch((e) => { console.error(e); process.exit(1); });
