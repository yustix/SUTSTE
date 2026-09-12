/**
 * Verifica el OCR (Tesseract + datos de idioma autoalojados) y el análisis posterior.
 * Uso: npx tsx scripts/test-ocr.ts [ruta-de-imagen]
 * Por defecto usa muestras/.pagina-escaneada.png (generada por scripts/generar-escaneado.py).
 */
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import { analyzeText, classify, normalizeText } from "../lib/summary-engine";
import { DEFAULT_PARAMS } from "../lib/schema-defs";

async function main() {
  const img =
    process.argv[2] ||
    path.join(process.cwd(), "muestras", ".pagina-escaneada.png");
  if (!fs.existsSync(img)) {
    console.error("No existe", img, "- ejecuta primero: python3 scripts/generar-escaneado.py");
    process.exit(1);
  }

  console.log("imagen:", img, `(${(fs.statSync(img).size / 1024).toFixed(0)} KB)`);
  const inicio = Date.now();

  const worker = await createWorker("spa", 1, {
    corePath: path.join(process.cwd(), "public", "ocr", "core"),
    langPath: path.join(process.cwd(), "public", "ocr", "lang"),
    gzip: true,
    logger: (m: any) => {
      if (m?.status) process.stdout.write(`\r  ${m.status} ${(Math.round((m.progress || 0) * 100) + "%").padStart(4)}`);
    },
  });
  const { data } = await worker.recognize(img);
  await worker.terminate();

  const texto = normalizeText(String(data.text || ""));
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`\n\nOCR terminado en ${segundos}s - confianza ${Math.round(data.confidence)}% - ${texto.split(/\s+/).length} palabras`);
  console.log("-".repeat(78));
  console.log(texto);
  console.log("-".repeat(78));

  const a = analyzeText(texto, { fileName: path.basename(img) });
  const c = classify(texto, a, DEFAULT_PARAMS as any, {
    typeToFolder: { oficio: "entrada", circular: "entrada", minuta: "mesas-de-trabajo", notificacion: "juridico", factura: "finanzas", otro: "entrada" },
    defaultArea: "externo",
  });

  console.log("TIPO      :", c.docTypeName, "| CARPETA:", c.folderName, "| AREA:", c.areaName);
  console.log("ESTATUS   :", c.status, "| PRIORIDAD:", a.priority, "| CONFIANZA:", Math.round(c.confidence * 100) + "%");
  console.log("RESPUESTA :", a.needsResponse ? "SI requiere" : "NO requiere", "->", a.responseHint);
  console.log("FECHAS    : doc =", a.docDate, "| limite =", a.dueDate);
  console.log("REMITE    :", a.entities.remitente, "| PARA:", a.entities.destinatario);
  console.log("FOLIO     :", a.entities.folios.join(", ") || "—");
  console.log("MONTOS    :", a.entities.amounts.map((m) => m.raw).join(" | ") || "—");
  console.log("RESUMEN   :\n  " + a.summary.replace(/\n/g, "\n  "));
  console.log("CLAVES    :");
  a.keyPoints.forEach((k) => console.log("  -", k));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
