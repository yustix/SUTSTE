/**
 * SUT STE - Motor local de análisis documental.
 * Extractivo, determinista, sin dependencias y sin enviar datos a terceros.
 * Produce: resumen, puntos clave, entidades, clasificacion y sugerencia de respuesta.
 */

const STOPWORDS = new Set(
  `a al algo algun alguna algunas alguno algunos ante aquel aquella aquellas aquello aquellos aqui aun aunque
   cada casi como con contra cual cuales cualquier cuando cuanto de del demas desde donde dos e el ella ellas ellos
   en entre era erais eran es esa esas ese eso esos esta estamos estan estar este esto estos estoy fue fueron fui
   ha hace hacia han hasta hay la las le les lo los luego me mi mia mientras misma mismo mucho muchos muy nada ni
   nos nosotros nuestra nuestro o os otra otras otro otros para pero poco por porque puede pueden pues que quien
   quienes se segun ser si sido sin sino sobre solo son su sus tal te tener tengo ti tiene tienen toda todas todo
   todos tras tu tus un una unas uno unos usted ustedes va vamos van varias varios y ya yo
   lic ing dr dra mtra mtro sr sra srta prof
   presente actual siguiente mediante traves respecto debido conforme
   hacer realizado realizar efecto fin cabo lugar parte
   numero num exp expediente`.split(/\s+/),
);

const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4,
  mayo: 5, may: 5, junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9, octubre: 10, oct: 10,
  noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};

const ACTION_VERBS = [
  "solicita", "solicito", "solicitamos", "solicitar", "solicitud", "requiere", "requerimiento",
  "requerimos", "exhorta", "instruye", "solicita su", "petición", "demanda", "exige", "insta",
  "invita", "convoca", "cita", "citatorio", "emplaza", "notifica", "requerir",
];

const QUESTION_WORDS = ["que", "como", "cuando", "donde", "cual", "quien", "por que", "cuanto"];

/** Disparadores de plazo. Cortos a proposito: la fecha se busca justo despues. */
const DEADLINE_RE =
  /(?:a\s+m[aá]?s\s+tardar|dentro\s+de\s+un\s+plazo\s+de|en\s+un\s+plazo\s+de|en\s+un\s+t[eé]?rmino\s+de|fecha\s+l[ií]?mite|antes\s+del|deber[aá]\s+(?:presentarse|remitirse|responder|contestar|entregarse)|plazo\s+de\s+\d{1,3}\s+d[ií]?as|t[eé]?rmino\s+de\s+\d{1,3}\s+d[ií]?as|no\s+posterior\s+al|a\s+m[aá]?s\s+tardar\s+el)/i;

/** Frase de plazo completa, para mostrarla como evidencia. */
const DEADLINE_CONTEXT_RE =
  /(?:a\s+m[aá]s\s+tardar[^.\n]{0,60}|dentro\s+de\s+un\s+plazo\s+de[^.\n]{0,40}|en\s+un\s+plazo\s+de[^.\n]{0,40}|en\s+un\s+t[eé]rmino\s+de[^.\n]{0,40}|fecha\s+l[ií]mite[^.\n]{0,40}|antes\s+del[^.\n]{0,40}|deber[aá]\s+(?:presentarse|remitirse|responder|contestar|entregarse)[^.\n]{0,40}|no\s+posterior\s+al[^.\n]{0,40})/i;

const RESPONSE_TRIGGERS =
  /(?:se solicita|solicito|le solicito|solicitamos|se requiere|requiero|requerimos|se le requiere|favor de|sirvase|s[ií]rvase|agradeceremos|agradecer[ií]a|se le agradece|quedamos a la espera|atenta respuesta|pronta respuesta|su respuesta|d[aá]rsele respuesta|darle respuesta|se le notifica|se notifica|se le cita|se le convoca|presentar (?:su |el )?(?:escrito|documento|informe|justificante|manifestaci[oó]n)|acuse de recibo|contestar|responder|remitir|env[ií]ar (?:su|el)|compar(?:ecer|ezca)|aclarar|subsanar)/i;

const BOILERPLATE =
  /(?:sin otro particular|sin m[aá]s por el momento|reciba un cordial|atentamente|agradeciendo de antemano|quedo de usted|protesto lo necesario|sufragio efectivo|no reelecci[oó]n|el presente documento|c\.?c\.?p\.?|copia para|archivo)/i;

/* ------------------------------------------------------------------ */
/*  Normalizacion                                                      */
/* ------------------------------------------------------------------ */

/** Etiquetas de encabezado: se parten en renglón propio para que no contaminen el resumen. */
const LABEL_RE =
  /^(?:oficio|folio|expediente|asunto|referencia|fecha|lugar|no\.?|n[uú]mero|atentamente|presente|c\.c\.p\.?|anexos?)\b[^\n]{0,40}?$/i;

/** Líneas de membrete en mayúsculas sostenidas. */
const CAPS_LINE_RE = /^[A-ZÁÉÍÓÚÑ0-9 .,:/()\'"-]{6,80}$/;

export function normalizeText(raw: string): string {
  let t = (raw || "").replace(/\r\n?/g, "\n");
  t = t.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  t = t.replace(/[ \t\f\v]+/g, " ");
  t = t.replace(/ ?\n ?/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");

  // Separa el encabezado del cuerpo: "OFICIO NUM. X ASUNTO: Y FECHA: Z C. NOMBRE ... PRESENTE. Por medio..."
  // se convierte en renglones independientes, y cada uno se trata como su propia frase.
  const lineas = t.split("\n").map((l) => {
    let x = l.trim();
    if (!x) return x;
    x = x.replace(/\b(PRESENTE)\s*\.?\s*/gi, "$1.\n");
    x = x.replace(/\b(ASUNTO|FECHA|OFICIO|FOLIO|EXPEDIENTE|REFERENCIA)\s*:?\s*/gi, "\n$1 ");
    x = x.replace(/\s+(?=C\.\s+[A-ZÁÉÍÓÚÑ]{3,})/g, "\n");
    x = x.replace(/\s+(?=[A-ZÁÉÍÓÚÑ]{2,}[a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ]{2,}[a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ]{2,})/, "\n");
    x = x.replace(/\s+(?=ATENTAMENTE\b)/gi, "\n");
    x = x.replace(/\s+(?=Por medio de la presente\b|Por medio del presente\b|En atenci[oó]n a\b|Con referencia a\b)/i, "\n");
    x = x.replace(/\s+(?=Se solicita\b|Se requiere\b|Solicito\b|Le solicito\b|Hago referencia\b)/i, "\n");
    return x.replace(/\n{2,}/g, "\n").replace(/^\n|\n$/g, "").trim();
  });

  t = lineas.join("\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function fold(s: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/* ------------------------------------------------------------------ */
/*  Frases                                                             */
/* ------------------------------------------------------------------ */

const PUNTO_INTERNO_RE = /^(?:[a-záéíóúñ]\.)+[a-záéíóúñ]?$/i;

const ABBREV = new Set([
  "sr", "sra", "srta", "dr", "dra", "lic", "ing", "arq", "mtra", "mtro", "c",
  "no", "num", "art", "av", "col", "cp", "ej", "etc", "mg", "kg", "s.a", "p.d",
]);

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = "";

  const flush = (joiner = " ") => {
    if (buf.trim()) out.push(buf.replace(/\s+/g, " ").trim() + joiner);
    buf = "";
  };

  /** Un salto de línea corta la frase cuando separa renglones de encabezado o de firma. */
  const corteEnSalto = (prev: string, next: string): boolean => {
    const p = prev.trim();
    if (!p) return false;
    if (/[.!?:]$/.test(p)) return true;
    const words = p.split(/\s+/).length;
    if (words <= 20 && CAPS_LINE_RE.test(p)) return true;
    if (words <= 14 && LABEL_RE.test(p)) return true;
    if (words <= 8) return true;
    if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(next)) return words <= 12;
    return false;
  };

  const lineas = text.split("\n");
  for (let li = 0; li < lineas.length; li++) {
    const linea = lineas[li];
    const finDeLinea = linea.length;
    for (let i = 0; i < finDeLinea; i++) {
      const ch = linea[i];
      buf += ch;
      if (ch !== "." && ch !== "!" && ch !== "?") continue;
      const next = linea[i + 1];
      const esUltimo = next === undefined || next.trim() === "";
      const prevWord = (buf.slice(0, -1).match(/([A-Za-záéíóúñüÁÉÍÓÚÑÜ.]+)$/) || [, ""])[1]
        .replace(/\./g, "")
        .toLowerCase();
      const tokenConPuntos = (buf.match(/([A-Za-zÁÉÍÓÚÑÜ](?:\.[A-Za-zÁÉÍÓÚÑÜ])+\.?)$/) || [""])[0];
      const isAbbrev =
        ch === "." && !esUltimo && (ABBREV.has(prevWord) || PUNTO_INTERNO_RE.test(tokenConPuntos));
      const nextIsLower = next !== undefined && /[a-záéíóúñ0-9(¿¡"]/i.test(next) && next === next.toLowerCase();
      if (!isAbbrev && (esUltimo || !nextIsLower)) flush();
    }

    if (!buf.trim()) continue;
    // siguiente renglón con contenido, saltando los vacíos
    let nextLinea = "";
    for (let j = li + 1; j < lineas.length; j++) {
      if (lineas[j].trim()) {
        nextLinea = lineas[j].trim();
        break;
      }
    }
    if (corteEnSalto(buf, nextLinea)) flush();
    else buf += " ";
  }
  flush("");

  return out
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => {
      const words = s.split(" ").length;
      if (words < 4 || words > 70) return false;
      if (/^(?:oficio|folio|expediente|asunto|referencia|fecha|atentamente|anexo|c\.c\.p)\b/i.test(s)) return false;
      if (LABEL_RE.test(s) && words < 10) return false;
      // membrete, destinatario en mayúsculas y bloques de firma
      if (!/[a-záéíóúñ]/.test(s) && words >= 3) return false;
      // restos de frase sueltos: sin mayúscula inicial ni cifras relevantes
      const first = s.replace(/^[¿¡"']+/g, "").charAt(0);
      if (first === first.toLowerCase() && !/\d/.test(s)) return false;
      return true;
    });
}

function tokens(sentence: string): string[] {
  return fold(sentence)
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/* ------------------------------------------------------------------ */
/*  Entidades                                                          */
/* ------------------------------------------------------------------ */

export interface Entities {
  folios: string[];
  dates: { iso: string; raw: string; index: number }[];
  amounts: { raw: string; value: number }[];
  people: string[];
  organizations: string[];
  emails: string[];
  phones: string[];
  asunto: string;
  remitente: string;
  destinatario: string;
  deadlineText: string;
}

const ORG_WORDS =
  /(secretar[ií]a|secretaria|direcci[oó]n|direccion|instituto|universidad|gobierno|ayuntamiento|municipio|sindicato|empresa|coordinaci[oó]n|coordinacion|departamento|comit[eé]|comite|junta|comisi[oó]n|comision|tesorer[ií]a|tesoreria|recursos humanos|contralor[ií]a|contraloria|procuradur[ií]a|fiscal[ií]a|fiscalia|tribunal|juzgado|congreso|c[aá]mara|camara|sistema|centro|escuela|colegio|hospital|delegaci[oó]n|delegacion|s\.a\.|s\.?c\.?|a\.c\.)/i;

export function extractEntities(text: string): Entities {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.slice(0, 25).join("\n");
  const tail = lines.slice(-25).join("\n");

  /* folios */
  const folios: string[] = [];
  const folioRe =
    /(?:oficio|folio|expediente|no\.?\s*de\s*oficio|n[uú]mero\s*de\s*oficio|referencia|radicado)\s*(?:n[uú]m(?:ero)?\.?|no\.?|#|:)?\s*([A-Z0-9][A-Z0-9./\-]{2,29})/gi;
  let m: RegExpExecArray | null;
  while ((m = folioRe.exec(text)) && folios.length < 6) {
    const v = m[1].replace(/[.,;:]+$/, "");
    if (v && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) folios.push(v);
  }

  /* fechas */
  const dates: { iso: string; raw: string; index: number }[] = [];
  const monthNames = Object.keys(MESES).join("|");
  const reLong = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${monthNames})\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b`, "gi");
  const reShort = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g;
  const push = (iso: string, raw: string, index: number) => {
    if (!iso) return;
    if (dates.some((d) => d.iso === iso)) return;
    dates.push({ iso, raw: raw.replace(/\s+/g, " ").trim(), index });
  };
  while ((m = reLong.exec(text)) && dates.length < 12) {
    const day = parseInt(m[1], 10);
    const mon = MESES[fold(m[2])];
    const year = parseInt(m[3], 10);
    if (mon && day >= 1 && day <= 31 && year >= 1900) push(isoDate(year, mon, day), m[0], m.index);
  }
  while ((m = reShort.exec(text)) && dates.length < 12) {
    let a = parseInt(m[1], 10);
    let b = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += y > 40 ? 1900 : 2000;
    if (a > 12 && b <= 12) { /* dd/mm */ } else if (a <= 12 && b > 12) { const t = a; a = b; b = t; }
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) push(isoDate(y, b, a), m[0], m.index);
  }
  dates.sort((x, y) => x.index - y.index);

  /* montos */
  const amounts: { raw: string; value: number }[] = [];
  const moneyRe = /\$\s*([\d][\d,]*(?:\.\d{1,2})?)|([\d][\d,]*(?:\.\d{1,2})?)\s*(?:pesos|mxn|m\.n\.)/gi;
  while ((m = moneyRe.exec(text)) && amounts.length < 10) {
    const raw = (m[1] || m[2] || "").trim();
    const value = parseAmount(raw);
    const prev = text.slice(Math.max(0, (m.index || 0) - 12), m.index || 0);
    const esFraccion = /\d{1,3}\s*\/\s*$/.test(prev); // "00/100 M.N."
    if (value >= 1 && !esFraccion) {
      const rawFull = m[0].trim().replace(/\s+/g, " ");
      if (!amounts.some((a) => a.value === value)) amounts.push({ raw: rawFull, value });
    }
  }

  /* personas */
  const people: string[] = [];
  const personRe =
    /(?:^|\n|\.|\()\s*((?:LIC|LICDA|ING|ARQ|DR|DRA|MTRA|MTRO|PROF|PROFRA|C|SR|SRA|SRTA)\.?\s+(?:[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑÜ'.]+\s+){1,4}[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑÜ'.]+)/g;
  while ((m = personRe.exec(text)) && people.length < 12) {
    const name = cleanName(m[1]);
    if (name && !ORG_WORDS.test(name)) people.push(name);
  }

  /* organizaciones */
  const organizations: string[] = [];
  const orgLines = lines.filter((l) => l.length > 6 && l.length < 110 && ORG_WORDS.test(l) && /[A-ZÁÉÍÓÚÑ]{2,}/.test(l));
  for (const l of orgLines.slice(0, 40)) {
    const c = l.replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
    if (!organizations.some((o) => fold(o).includes(fold(c)) || fold(c).includes(fold(o)))) organizations.push(c);
    if (organizations.length >= 5) break;
  }

  /* contacto */
  const emails = Array.from(new Set((text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g) || []).map((e) => e.toLowerCase()))).slice(0, 5);
  const phones = Array.from(
    new Set((text.match(/(?:\+?52\s*)?(?:\(\d{2,3}\)\s*)?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}/g) || []).map((p) => p.trim())),
  ).slice(0, 5);

  /* asunto */
  let asunto = "";
  const am = head.match(/(?:asunto|referencia)\s*:?\s*([^\n]{3,120})/i);
  if (am) asunto = am[1].trim().replace(/[.;]+$/, "");

  /* remitente / destinatario */
  const kindHint = quickDocType(text);
  const remitente = pickSender(lines, head, tail, people, organizations, kindHint);
  const destinatario = pickRecipient(lines, head, people, kindHint);

  /* plazo textual */
  let deadlineText = "";
  const dm = text.match(DEADLINE_CONTEXT_RE);
  if (dm) deadlineText = dm[0].trim();

  return { folios, dates, amounts, people, organizations, emails, phones, asunto, remitente, destinatario, deadlineText };
}

function isoDate(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function parseAmount(raw: string): number {
  const digits = raw.replace(/[^\d.,]/g, "");
  if (!digits) return 0;
  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  let normalized = digits;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot ? digits.replace(/\./g, "").replace(",", ".") : digits.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = digits.slice(lastComma + 1);
    normalized = decimals.length === 3 && digits.split(",").length > 2 ? digits.replace(/,/g, "") : digits.replace(",", ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function cleanName(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(LIC|LICDA|ING|ARQ|DR|DRA|MTRA|MTRO|PROF|PROFRA|SR|SRA|SRTA|C)\.?\s+/i, "")
    .replace(/[.,;:()\[\]]+$/g, "")
    .trim();
}

/** Tipo de documento preliminar, solo para orientar la extraccion de remitente y destinatario. */
function quickDocType(text: string): string {
  const t = fold(text.slice(0, 1200));
  if (/\bminuta\b|\bacta de\b|orden del dia/.test(t)) return "minuta";
  if (/\bconvenio\b/.test(t)) return "convenio";
  if (/\bcontrato\b/.test(t)) return "contrato";
  if (/\bcircular\b/.test(t)) return "circular";
  if (/\boficio\b/.test(t)) return "oficio";
  if (/\bfactura\b|comprobante fiscal|cfdi/.test(t)) return "factura";
  if (/\binforme\b|reporte de actividades/.test(t)) return "informe";
  return "";
}

const ALL_CAPS_RECIPIENT = /^(A\s+)?(TODO|TODOS|TODAS|LOS|LAS)\s+(EL\s+)?(PERSONAL|TRABAJADOR|TRABAJADORES|AGREMIADO|AGREMIADOS|MIEMBRO|MIEMBROS|ASUNTO)/i;

function isJunkName(s: string): boolean {
  const t = (s || "").trim();
  if (t.length < 4) return true;
  if (/[_\-*=.#]{3,}/.test(t)) return true;
  if (/^\d/.test(t)) return true;
  if ((t.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, "").length / Math.max(1, t.length)) < 0.6) return true;
  if (/^(calle|colonia|avenida|av\.|cp\s|telefono|tel\.|correo|www\.|http)/i.test(t)) return true;
  return false;
}

function pickSender(
  lines: string[],
  head: string,
  tail: string,
  people: string[],
  orgs: string[],
  kindHint = "",
): string {
  // En actas y convenios la firma no identifica a quien lo envia: manda el membrete
  const colectivos = ["minuta", "convenio", "contrato"];
  if (!colectivos.includes(kindHint)) {
    // Firmas al final del documento
    const tailLines = tail.split("\n").map((l) => l.trim()).filter(Boolean);
    const signIdx = tailLines.findIndex((l) => /atentamente|protesto lo necesario|cordialmente|sinceramente/i.test(l));
    if (signIdx > -1) {
      for (const l of tailLines.slice(signIdx + 1, signIdx + 8)) {
        const clean = cleanName(l);
        if (!isJunkName(clean) && !ORG_WORDS.test(clean) && !/^(atentamente|protesto|cordialmente)/i.test(clean)) {
          return clean;
        }
      }
    }
  }
  // Membrete o razon social
  for (const l of lines.slice(0, 12)) {
    if (l.length > 6 && l.length < 90 && ORG_WORDS.test(l) && !ALL_CAPS_RECIPIENT.test(l)) return l.trim();
  }
  const firmante = people.find((pp) => !isJunkName(pp));
  if (firmante) return firmante;
  return (orgs.find((o) => !isJunkName(o)) || "").trim();
}

function pickRecipient(lines: string[], head: string, people: string[], kindHint = ""): string {
  if (["minuta", "convenio", "contrato"].includes(kindHint)) return "";

  const headLines = head.split("\n").map((l) => l.trim()).filter(Boolean);

  const colectivo = headLines.find((l) => ALL_CAPS_RECIPIENT.test(l) && l.length < 90);
  if (colectivo) return colectivo.replace(/[:.]+$/, "");

  const idxPresente = headLines.findIndex((l) => /^(presente|p\.?\s*e\.?\s*d\.?)\.?$/i.test(l));
  if (idxPresente > 0) {
    const CARGO = /(director|directora|jefe|jefa|encargad|coordinador|coordinadora|gerente|secretari|tesorer|contralor|subdirector|supervisor|presidente|presidenta|titular)/i;
    let best = "";
    let bestScore = 0;
    for (let i = Math.max(0, idxPresente - 4); i < idxPresente; i++) {
      const raw = headLines[i];
      const clean = cleanName(raw);
      if (isJunkName(clean) || clean.length > 90) continue;
      let score = 1;
      if (/(?:^|\s)(C\.?|LIC\.?|ING\.?|DR\.?|DRA\.?|MTRA\.?|MTRO\.?|PROF\.?|SR\.?|SRA\.?|SRTA\.?)(?:\s|$)/i.test(raw)) score += 4;
      const letters = raw.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, "");
      const uppers = raw.replace(/[^A-ZÁÉÍÓÚÑ]/g, "");
      if (letters.length > 6 && uppers.length / letters.length > 0.8) score += 2.5;
      if (CARGO.test(raw)) score -= 2;
      if (score > bestScore) {
        bestScore = score;
        best = clean;
      }
    }
    if (best && bestScore >= 2) return best;
  }

  const cm = head.match(
    /(?:^|\n)\s*C\.?\s+(?:LIC\.?\s+|LICDA\.?\s+|ING\.?\s+|DR\.?\s+|DRA\.?\s+|MTRA\.?\s+)?([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑÜ' .]{5,60})/,
  );
  if (cm) {
    const clean = cleanName(cm[1]);
    if (!isJunkName(clean)) return clean;
  }
  return "";
}

/* ------------------------------------------------------------------ */
/*  Resumen extractivo                                                 */
/* ------------------------------------------------------------------ */

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  entities: Entities;
  needsResponse: boolean;
  responseHint: string;
  responseSignals: string[];
  priority: string;
  confidence: number;
  dueDate: string | null;
  docDate: string | null;
  wordCount: number;
}

export function analyzeText(text: string, opts: { fileName?: string } = {}): SummaryResult {
  const normalized = normalizeText(text);
  const wordCount = (normalized.match(/\S+/g) || []).length;
  const entities = extractEntities(normalized);
  const sentences = splitSentences(normalized);

  const empty: SummaryResult = {
    summary: "",
    keyPoints: [],
    entities,
    needsResponse: false,
    responseHint: "No se detectó texto suficiente para analizar el documento.",
    responseSignals: [],
    priority: "baja",
    confidence: 0,
    dueDate: null,
    docDate: null,
    wordCount,
  };
  if (sentences.length === 0) return empty;

  /* frecuencia de terminos */
  const freq = new Map<string, number>();
  const totalTokens: string[] = [];
  for (const s of sentences) {
    for (const t of tokens(s)) {
      totalTokens.push(t);
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  const maxFreq = Math.max(1, ...freq.values());
  const n = totalTokens.length || 1;

  /* puntuacion de frases */
  const scored = sentences.map((s, i) => {
    const ts = tokens(s);
    let score = 0;
    for (const t of ts) score += (freq.get(t) || 0) / maxFreq;
    score = ts.length ? score / Math.sqrt(ts.length) : 0;

    const f = fold(s);
    if (i === 0) score *= 1.55;
    else if (i === 1) score *= 1.3;
    else if (i === sentences.length - 1) score *= 0.8;

    if (/\d/.test(s)) score += 0.22;
    if (/\$|mxn|pesos/i.test(s)) score += 0.3;
    if (DEADLINE_RE.test(s)) score += 0.5;
    if (RESPONSE_TRIGGERS.test(s)) score += 0.45;
    if (/\?/.test(s)) score += 0.3;
    for (const v of ACTION_VERBS) if (f.includes(v)) { score += 0.3; break; }
    if (BOILERPLATE.test(s)) score -= 0.5;
    if (s.split(" ").length < 6) score -= 0.25;
    if (/^[),;:]/.test(s)) score -= 0.6;
    if (s.split(" ").length < 7) score -= 0.25;
    if (s.split(" ").length > 42) score -= 0.15;
    if (/^[A-ZÁÉÍÓÚÑ\s]{4,}$/.test(s)) score -= 0.3;

    return { s, i, score, ts };
  });

  const target = wordCount < 180 ? 2 : wordCount < 500 ? 3 : wordCount < 1400 ? 4 : 5;
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, target).sort((a, b) => a.i - b.i);

  const summary = capitalizar(
    top
      .map((x) => truncate(x.s.replace(/\s+/g, " ").trim(), 300))
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );

  /* puntos clave */
  const keyPoints: string[] = [];
  if (entities.asunto) keyPoints.push(`Asunto: ${truncate(entities.asunto, 140)}`);
  if (entities.remitente) keyPoints.push(`Remitente: ${entities.remitente}`);
  if (entities.destinatario) keyPoints.push(`Dirigido a: ${entities.destinatario}`);
  if (entities.folios.length) keyPoints.push(`Folio u oficio: ${entities.folios.slice(0, 3).join(", ")}`);

  const docDate = pickDocDate(entities, normalized);
  const dueDate = pickDueDate(entities, normalized, docDate);
  if (docDate) keyPoints.push(`Fecha del documento: ${formatMX(docDate)}`);
  if (dueDate) keyPoints.push(`Fecha límite detectada: ${formatMX(dueDate)}`);
  if (entities.amounts.length) {
    const max = entities.amounts.reduce((a, b) => (b.value > a.value ? b : a), entities.amounts[0]);
    keyPoints.push(`Monto mencionado: $${max.value.toLocaleString("es-MX")}`);
  }
  const actionPoint = scored
    .filter((x) => RESPONSE_TRIGGERS.test(x.s) || DEADLINE_RE.test(x.s))
    .sort((a, b) => b.score - a.score)[0];
  if (actionPoint && !keyPoints.some((k) => k === truncate(actionPoint.s, 160))) {
    keyPoints.push(`Petición: ${capitalizar(truncate(actionPoint.s, 160))}`);
  }
  if (entities.organizations.length) keyPoints.push(`Instituciones: ${entities.organizations.slice(0, 2).join(" | ")}`);
  if (entities.emails.length) keyPoints.push(`Contacto: ${entities.emails[0]}`);

  /* sugerencia de respuesta */
  const { needsResponse, responseHint, responseSignals } = detectResponse(normalized, entities, dueDate, keyPoints);

  /* prioridad: solo tiene sentido si el documento exige seguimiento */
  let priority = "baja";
  if (needsResponse) {
    const days = dueDate ? Math.round((new Date(dueDate + "T12:00:00").getTime() - Date.now()) / 86400000) : null;
    if (days !== null && days <= 15) priority = "alta";
    else if (days !== null && days <= 45) priority = "media";
    else if (responseSignals.some((x) => x.startsWith("Plazo"))) priority = "media";
    else if (responseSignals.length >= 3) priority = "media";
  }

  const coverage = summary.length / Math.max(1, normalized.length);
  const confidence = clamp(
    0.35 +
      (wordCount > 120 ? 0.2 : wordCount / 600) +
      (entities.remitente ? 0.12 : 0) +
      (entities.asunto || entities.folios.length ? 0.1 : 0) +
      (docDate ? 0.08 : 0) +
      Math.min(0.15, coverage * 1.2),
    0,
    0.99,
  );

  return {
    summary: summary || truncate(normalized, 400),
    keyPoints: keyPoints.slice(0, 8),
    entities,
    needsResponse,
    responseHint,
    responseSignals,
    priority,
    confidence: Number(confidence.toFixed(2)),
    dueDate,
    docDate,
    wordCount,
  };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** Pone en mayúscula la inicial, aunque la frase venga partida por un salto de línea. */
function capitalizar(s: string): string {
  const t = (s || "").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function truncate(s: string, n: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/[,;:\s]+$/, "") + "…";
}

function pickDocDate(e: Entities, text: string): string | null {
  if (e.dates.length === 0) return null;
  const headDates = e.dates.filter((d) => d.index < Math.max(600, text.length * 0.12));
  if (headDates.length) return headDates[0].iso;
  return e.dates[0].iso;
}

function pickDueDate(e: Entities, text: string, docDate: string | null): string | null {
  const dm = text.match(DEADLINE_RE);
  if (!dm || dm.index === undefined) return null;

  const at: number = dm.index;
  const start = at + dm[0].length;
  const after = text.slice(start, start + 140);

  // "a partir del 5 de enero" describe un inicio de vigencia, no un plazo de respuesta
  if (/a\s+partir\s+de[l]?\s/i.test(after.slice(0, 60))) return null;

  // fecha inmediata despues de la frase de plazo
  const near = e.dates.find((d) => d.index >= at && d.index <= start + 90);
  if (near) {
    const entre = text.slice(start, near.index);
    if (/a\s+partir\s+de[l]?\s/i.test(entre)) return null;
    return near.iso;
  }

  // "antes del 19 de diciembre" sin año: se completa con el año del documento
  const dm2 = after.match(/^\s*(?:el\s+|la\s+|los\s+|las\s+)?(?:[A-Za-záéíóúñ]+\s+)?(\d{1,2})\s+de\s+([A-Za-záéíóúñ]+)/i);
  if (dm2 && docDate) {
    const month = MESES[fold(dm2[2])];
    const day = parseInt(dm2[1], 10);
    const docYear = parseInt(docDate.slice(0, 4), 10);
    if (month && day >= 1 && day <= 31) {
      let candidate = isoDate(docYear, month, day);
      if (candidate < docDate) candidate = isoDate(docYear + 1, month, day);
      return candidate;
    }
  }

  // plazo relativo: "dentro de un plazo de 10 dias habiles"
  const daysMatch = (dm[0] + " " + after).match(/(\d{1,3})\s*d[ií]?as?\s*(?:h[aá]?biles|habiles|naturales)?/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    if (days > 0 && days < 400) {
      const base = docDate ? new Date(docDate + "T12:00:00") : new Date();
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function detectResponse(
  text: string,
  e: Entities,
  dueDate: string | null,
  keyPoints: string[],
): { needsResponse: boolean; responseHint: string; responseSignals: string[] } {
  let score = 0;
  const signals: string[] = [];

  if (RESPONSE_TRIGGERS.test(text)) {
    const m = text.match(RESPONSE_TRIGGERS);
    score += 2.5;
    signals.push(`Petición explícita: "${(m?.[0] || "").trim()}"`);
  }
  if (DEADLINE_RE.test(text)) {
    score += 2;
    signals.push("Plazo o fecha límite mencionada");
  }
  const qCount = (text.match(/[?]/g) || []).length;
  if (qCount > 0) {
    const hasQWord = QUESTION_WORDS.some((w) => fold(text).includes(w));
    score += hasQWord ? 1.5 : 0.8;
    signals.push(`Contiene ${qCount} pregunta${qCount > 1 ? "s" : ""}`);
  }
  for (const v of ACTION_VERBS) {
    if (fold(text).includes(v)) {
      score += 1.2;
      signals.push(`Verbo de acción detectado: "${v}"`);
      break;
    }
  }
  if (e.amounts.length) {
    score += 0.6;
    signals.push("Se mencionan montos o cifras");
  }
  if (/convenio|contrato|cl[aá]usula|clausula|acta|resoluci[oó]n|laudo/i.test(text)) {
    score += 0.8;
    signals.push("Documento con efectos jurídicos o administrativos");
  }
  if (/se hace de su conocimiento|para su conocimiento|informativo|aviso general/i.test(text)) {
    score -= 2.5;
    signals.push("Tono informativo (solo para conocimiento)");
  }
  if (/(?:^|\n)\s*(?:circular|bolet[ií]n|boletin|comunicado)/im.test(text)) {
    score -= 1.5;
    signals.push("Formato de circular o comunicado general");
  }
  if (/gr[aá]fica|grafica|tabla|anexo [a-z]\b|estad[ií]stica|estadistica/i.test(text)) {
    score -= 0.4;
  }

  const needsResponse = score >= 3;

  let hint: string;
  if (needsResponse) {
    const bits: string[] = [];
    if (e.remitente) bits.push(`dirigida a ${e.remitente}`);
    if (e.folios[0]) bits.push(`citando el folio ${e.folios[0]}`);
    if (dueDate) bits.push(`antes del ${formatMX(dueDate)}`);
    hint =
      `Conviene responder: se ${score >= 5 ? "requiere" : "sugiere"} una contestación por escrito` +
      (bits.length ? ` ${bits.join(", ")}` : "") +
      ". " +
      (signals[0] || "");
  } else {
    hint = "No parece requerir respuesta: se recomienda archivar y dar seguimiento solo si cambia el estatus.";
  }
  if (!signals.length) signals.push("Sin señales concluyentes; revisa el resumen manualmente.");

  return { needsResponse, responseHint: truncate(hint, 400), responseSignals: signals.slice(0, 6) };
}

/* ------------------------------------------------------------------ */
/*  Clasificacion                                                      */
/* ------------------------------------------------------------------ */

export interface ParamLike {
  slug: string;
  name: string;
  kind: string;
  keywords?: string[];
  patterns?: string[];
}

export interface Classification {
  docType: string;
  docTypeName: string;
  folder: string;
  folderName: string;
  area: string;
  areaName: string;
  status: string;
  confidence: number;
  matched: string[];
}

export function classify(
  text: string,
  analysis: SummaryResult,
  params: ParamLike[],
  opts: { typeToFolder?: Record<string, string>; defaultArea?: string } = {},
): Classification {
  const t = text || "";
  const ft = fold(t);
  const head = fold(t.slice(0, 1200));
  const matched: string[] = [];

  const score = (p: ParamLike, weight: number): number => {
    let s = 0;
    for (const kw of p.keywords || []) {
      const k = fold(kw);
      if (!k) continue;
      if (head.includes(k)) s += 2.2 * weight;
      else if (ft.includes(k)) s += 1 * weight;
      const count = ft.split(k).length - 1;
      if (count > 1) s += Math.min(1.6, (count - 1) * 0.28) * weight;
    }
    for (const pat of p.patterns || []) {
      try {
        const re = new RegExp(pat, "i");
        if (re.test(t)) s += 2 * weight;
      } catch {
        /* patron invalido: se ignora */
      }
    }
    return s;
  };

  const tipos = params.filter((p) => p.kind === "tipo");
  let bestType: ParamLike | null = null;
  let bestTypeScore = 0;
  for (const p of tipos) {
    const s = score(p, 1);
    if (s > bestTypeScore) {
      bestTypeScore = s;
      bestType = p;
    }
  }
  if (!bestType || bestTypeScore < 1.5) {
    bestType = tipos.find((p) => p.slug === "otro") || tipos[0] || null;
    bestTypeScore = 0;
  } else {
    matched.push(`Tipo "${bestType.name}" por coincidencia de terminos`);
  }

  /* carpeta: reglas propias de carpeta > mapa tipo a carpeta */
  const carpetas = params.filter((p) => p.kind === "carpeta");
  let bestFolder: ParamLike | null = null;
  let bestFolderScore = 0;
  for (const p of carpetas) {
    const s = score(p, 1.15);
    if (s > bestFolderScore) {
      bestFolderScore = s;
      bestFolder = p;
    }
  }
  if (bestFolder && bestFolderScore >= 2) {
    matched.push(`Carpeta "${bestFolder.name}" por sus propias palabras clave`);
  } else {
    const mapped = opts.typeToFolder?.[bestType?.slug || ""];
    bestFolder = carpetas.find((c) => c.slug === mapped) || null;
    if (bestFolder) matched.push(`Carpeta "${bestFolder.name}" asignada por regla del tipo de documento`);
  }
  if (!bestFolder) {
    bestFolder = carpetas.find((c) => c.slug === "entrada") || carpetas[0] || null;
  }

  /* area */
  const areas = params.filter((p) => p.kind === "area");
  let bestArea: ParamLike | null = null;
  let bestAreaScore = 0;
  const campo = fold(`${analysis.entities.destinatario} ${analysis.entities.remitente} ${t.slice(0, 900)}`);
  for (const p of areas) {
    let s = score(p, 1);
    if (p.keywords?.length) {
      for (const kw of p.keywords) if (campo.includes(fold(kw))) s += 2;
    }
    if (fold(p.name) && campo.includes(fold(p.name))) s += 2.5;
    if (s > bestAreaScore) {
      bestAreaScore = s;
      bestArea = p;
    }
  }
  if (!bestArea || bestAreaScore < 2) {
    bestArea = areas.find((a) => a.slug === (opts.defaultArea || "externo")) || areas[0] || null;
  } else {
    matched.push(`Área "${bestArea.name}" identificada en el encabezado`);
  }

  const needs = analysis.needsResponse;
  const status = needs ? "por_responder" : "archivado";

  const totalPossible = Math.max(1, (bestType?.keywords?.length || 4) * 2.2);
  const confidence = clamp(
    (bestTypeScore / totalPossible) * 0.6 + (bestFolderScore > 0 ? 0.2 : 0.1) + (bestAreaScore > 2 ? 0.2 : 0.1),
    0.05,
    0.98,
  );

  return {
    docType: bestType?.slug || "",
    docTypeName: bestType?.name || "Otros",
    folder: bestFolder?.slug || "",
    folderName: bestFolder?.name || "",
    area: bestArea?.slug || "",
    areaName: bestArea?.name || "",
    status,
    confidence: Number(confidence.toFixed(2)),
    matched,
  };
}

/* ------------------------------------------------------------------ */
/*  Formato de fechas                                                  */
/* ------------------------------------------------------------------ */

const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function formatMX(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return iso;
  return `${d} de ${MESES_LARGOS[m - 1]} de ${y}`;
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T12:00:00").getTime();
  if (Number.isNaN(target)) return null;
  return Math.round((target - Date.now()) / 86400000);
}
