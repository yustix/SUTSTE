/**
 * Esquema y valores por defecto compartidos entre servidor y cliente.
 * Sin dependencias externas.
 */

export const DOC_STATUSES = [
  { slug: "por_responder", name: "Por responder" },
  { slug: "en_proceso", name: "En proceso" },
  { slug: "respondido", name: "Respondido" },
  { slug: "archivado", name: "Solo archivo" },
] as const;

export const PRIORITIES = [
  { slug: "alta", name: "Alta" },
  { slug: "media", name: "Media" },
  { slug: "baja", name: "Baja" },
] as const;

export const DEFAULT_DOC_TYPES = [
  {
    slug: "oficio",
    name: "Oficio",
    color: "#1e5fbf",
    keywords: [
      "oficio",
      "no. de oficio",
      "numero de oficio",
      "asunto",
      "c. secretario",
      "presente",
      "atentamente",
    ],
    patterns: ["oficio\\s*(num\\.?|no\\.?|#)?\\s*[a-z0-9/\\-.]+"],
    needsResponse: true,
  },
  {
    slug: "circular",
    name: "Circular",
    color: "#2f7fd1",
    keywords: ["circular", "a todo el personal", "se hace de su conocimiento", "aviso general"],
    patterns: ["circular\\s*(num\\.?|no\\.?|#)?\\s*[a-z0-9/\\-.]*"],
    needsResponse: false,
  },
  {
    slug: "convenio",
    name: "Convenio",
    color: "#155a9e",
    keywords: [
      "convenio",
      "clausula",
      "clausulas",
      "declaraciones",
      "las partes",
      "marco juridico",
      "vigencia del convenio",
    ],
    patterns: [],
    needsResponse: false,
  },
  {
    slug: "contrato",
    name: "Contrato",
    color: "#0f4c81",
    keywords: ["contrato", "el patrón", "el trabajador", "contratacion colectiva", "tabulador", "salario"],
    patterns: [],
    needsResponse: false,
  },
  {
    slug: "minuta",
    name: "Minuta de reunión",
    color: "#3a86c8",
    keywords: ["minuta", "acuerdos", "siendo las", "se reunieron", "orden del dia", "asistentes", "mesa de trabajo"],
    patterns: [],
    needsResponse: true,
  },
  {
    slug: "solicitud",
    name: "Solicitud",
    color: "#1a6fb5",
    keywords: ["solicitud", "solicito", "por medio de la presente solicito", "peticion", "requerimiento"],
    patterns: [],
    needsResponse: true,
  },
  {
    slug: "notificacion",
    name: "Notificación",
    color: "#0d4a7a",
    keywords: ["notificacion", "se le notifica", "hace constar", "emplazamiento", "audiencia", "resolucion"],
    patterns: [],
    needsResponse: true,
  },
  {
    slug: "informe",
    name: "Informe",
    color: "#4a90d9",
    keywords: ["informe", "resultado", "avance", "reporte de actividades", "indicadores", "estadistica"],
    patterns: [],
    needsResponse: false,
  },
  {
    slug: "factura",
    name: "Factura o comprobante",
    color: "#5aa0e0",
    keywords: ["factura", "comprobante fiscal", "cfdi", "rfc", "subtotal", "iva", "total", "folio fiscal", "uuid"],
    patterns: ["folio fiscal", "uuid[:\\s]*[0-9a-f-]{36}"],
    needsResponse: false,
  },
  {
    slug: "queja",
    name: "Queja o inconformidad",
    color: "#123f6b",
    keywords: ["queja", "inconformidad", "inconforme", "inconformo", "violacion", "agravio", "demandado"],
    patterns: [],
    needsResponse: true,
  },
  {
    slug: "otro",
    name: "Otros",
    color: "#7aa7cc",
    keywords: [],
    patterns: [],
    needsResponse: false,
  },
];

export const DEFAULT_FOLDERS = [
  { slug: "entrada", name: "Entrada", color: "#1e5fbf" },
  { slug: "salida", name: "Salida", color: "#2f7fd1" },
  { slug: "asuntos-laborales", name: "Asuntos laborales", color: "#155a9e" },
  { slug: "convenios-contratos", name: "Convenios y contratos", color: "#0f4c81" },
  { slug: "mesas-de-trabajo", name: "Mesas de trabajo", color: "#3a86c8" },
  { slug: "finanzas", name: "Finanzas", color: "#1a6fb5" },
  { slug: "juridico", name: "Jurídico", color: "#0d4a7a" },
  { slug: "recursos-humanos", name: "Recursos humanos", color: "#4a90d9" },
  { slug: "archivo-muerto", name: "Archivo histórico", color: "#5aa0e0" },
];

export const DEFAULT_AREAS = [
  { slug: "direccion", name: "Dirección" },
  { slug: "secretaria-general", name: "Secretaría General" },
  { slug: "recursos-humanos", name: "Recursos Humanos" },
  { slug: "finanzas", name: "Finanzas" },
  { slug: "juridico", name: "Jurídico" },
  { slug: "afiliacion", name: "Afiliacion" },
  { slug: "externo", name: "Externo" },
];

export const PARAM_KINDS = ["tipo", "carpeta", "area"] as const;

export const DEFAULT_PARAMS = [
  ...DEFAULT_DOC_TYPES.map((t, i) => ({
    kind: "tipo" as const,
    name: t.name,
    slug: t.slug,
    color: t.color,
    position: i,
    keywords: t.keywords,
    patterns: t.patterns,
  })),
  ...DEFAULT_FOLDERS.map((f, i) => ({
    kind: "carpeta" as const,
    name: f.name,
    slug: f.slug,
    color: f.color,
    position: i,
    keywords: [] as string[],
    patterns: [] as string[],
  })),
  ...DEFAULT_AREAS.map((a, i) => ({
    kind: "area" as const,
    name: a.name,
    slug: a.slug,
    color: "",
    position: i,
    keywords: [] as string[],
    patterns: [] as string[],
  })),
];

export interface DocRecord {
  id: string;
  owner_id: string;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  file_url: string | null;
  file_key: string | null;
  text_content: string;
  summary: string;
  key_points: string[];
  entities: Record<string, unknown>;
  doc_type: string;
  folder: string;
  area: string;
  priority: string;
  status: string;
  sender: string;
  recipient: string;
  doc_number: string;
  received_on: string | null;
  due_on: string | null;
  doc_date: string | null;
  needs_response: boolean;
  response_hint: string;
  confidence: number;
  tags: string[];
  response_draft: string;
  response_sent_at: string | null;
  notes: string;
  rev: number;
  deleted: boolean;
  created_at: string;
  updated_at: string;
}
