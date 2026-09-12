import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { uid, nowISO } from "./util";
import type { DocRecord } from "./schema-defs";

/* ------------------------------------------------------------------ */
/*  Almacenamiento: Neon Postgres en produccion, JSON local en dev.    */
/* ------------------------------------------------------------------ */

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

type Row = Record<string, unknown>;

interface LocalShape {
  users: Row[];
  documents: Row[];
  params: Row[];
  settings: Row[];
}

export interface Store {
  kind: "neon" | "local";
  /** true cuando no se puede escribir (p. ej. Vercel sin DATABASE_URL). */
  readOnly: boolean;
  /* usuarios */
  getUserByEmail(email: string): Promise<Row | null>;
  getUserById(id: string): Promise<Row | null>;
  countUsers(): Promise<number>;
  createUser(u: { id?: string; email: string; name: string; password_hash: string; role?: string }): Promise<Row>;
  /* documentos */
  listDocuments(ownerId: string, opts?: { includeDeleted?: boolean }): Promise<DocRecord[]>;
  getDocument(ownerId: string, id: string): Promise<DocRecord | null>;
  documentsChangedSince(ownerId: string, since: number): Promise<DocRecord[]>;
  upsertDocuments(docs: Partial<DocRecord>[]): Promise<DocRecord[]>;
  deleteDocument(ownerId: string, id: string): Promise<void>;
  /* parametros */
  listParams(ownerId: string): Promise<Row[]>;
  upsertParams(params: Row[]): Promise<void>;
  deleteParam(ownerId: string, id: string): Promise<void>;
  /* ajustes */
  getSettings(ownerId: string): Promise<Row>;
  saveSettings(ownerId: string, data: Row): Promise<void>;
  /* archivos (dev local) */
  saveLocalFile(key: string, buf: Buffer, mime: string): Promise<string>;
  readLocalFile(key: string): Promise<{ buf: Buffer; mime: string } | null>;
}

/* ------------------------------- helpers -------------------------- */

/**
 * Crea las carpetas de desarrollo. Devuelve false cuando el sistema de archivos
 * es de solo lectura (Vercel, contenedores inmutables), para no reventar la app.
 */
function ensureDirs(): boolean {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

const READ_ONLY_MESSAGE =
  "Este despliegue no tiene DATABASE_URL, así que no hay dónde guardar los datos (en Vercel el disco es de solo lectura). " +
  "Crea una base en Neon, pega DATABASE_URL en las variables de entorno y vuelve a desplegar.";

function readLocal(): LocalShape {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) return { users: [], documents: [], params: [], settings: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return { users: raw.users || [], documents: raw.documents || [], params: raw.params || [], settings: raw.settings || [] };
  } catch {
    return { users: [], documents: [], params: [], settings: [] };
  }
}

let writeQueue: Promise<void> = Promise.resolve();
function writeLocal(db: LocalShape) {
  const data = JSON.stringify(db, null, 0);
  writeQueue = writeQueue.then(() => {
    try {
      if (!ensureDirs()) return;
      fs.writeFileSync(DB_FILE, data, "utf8");
    } catch (e) {
      console.error("[store] no se pudo escribir la base local:", e);
    }
  });
  return writeQueue;
}

function normalizeDoc(r: Row): DocRecord {
  const parse = (v: unknown, fb: unknown) => {
    if (v == null) return fb;
    if (typeof v === "object") return v;
    try {
      return JSON.parse(String(v));
    } catch {
      return fb;
    }
  };
  return {
    id: String(r.id),
    owner_id: String(r.owner_id ?? ""),
    title: String(r.title ?? ""),
    file_name: String(r.file_name ?? ""),
    mime_type: String(r.mime_type ?? ""),
    size_bytes: Number(r.size_bytes ?? 0),
    file_url: (r.file_url as string) ?? null,
    file_key: (r.file_key as string) ?? null,
    text_content: String(r.text_content ?? ""),
    summary: String(r.summary ?? ""),
    key_points: parse(r.key_points, []) as string[],
    entities: parse(r.entities, {}) as Record<string, unknown>,
    doc_type: String(r.doc_type ?? ""),
    folder: String(r.folder ?? ""),
    area: String(r.area ?? ""),
    priority: String(r.priority ?? ""),
    status: String(r.status ?? "archivado"),
    sender: String(r.sender ?? ""),
    recipient: String(r.recipient ?? ""),
    doc_number: String(r.doc_number ?? ""),
    received_on: (r.received_on as string) ?? null,
    due_on: (r.due_on as string) ?? null,
    doc_date: (r.doc_date as string) ?? null,
    needs_response: Boolean(r.needs_response),
    response_hint: String(r.response_hint ?? ""),
    confidence: Number(r.confidence ?? 0),
    tags: parse(r.tags, []) as string[],
    response_draft: String(r.response_draft ?? ""),
    response_sent_at: (r.response_sent_at as string | null) ?? null,
    notes: String(r.notes ?? ""),
    rev: Number(r.rev ?? 1),
    deleted: Boolean(r.deleted),
    created_at: toISO(r.created_at),
    updated_at: toISO(r.updated_at),
  };
}

function toISO(v: unknown): string {
  if (!v) return nowISO();
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? nowISO() : d.toISOString();
}

const DOC_COLUMNS = [
  "id", "owner_id", "title", "file_name", "mime_type", "size_bytes", "file_url", "file_key",
  "text_content", "summary", "key_points", "entities", "doc_type", "folder", "area", "priority",
  "status", "sender", "recipient", "doc_number", "received_on", "due_on", "doc_date",
  "needs_response", "response_hint", "confidence", "tags", "response_draft", "response_sent_at",
  "notes", "rev", "deleted", "created_at", "updated_at",
] as const;

/* --------------------------- Neon Postgres ------------------------ */

function makeNeonStore(url: string): Store {
  // neon() devuelve una funcion de consulta directa (driver HTTP serverless)
  const sql = neon(url) as unknown as (q: string, params?: unknown[]) => Promise<Row[]>;

  return {
    kind: "neon",
    readOnly: false,

    async getUserByEmail(email) {
      const rows = await sql("SELECT * FROM users WHERE email = $1 LIMIT 1", [email]);
      return (rows[0] as Row) ?? null;
    },
    async getUserById(id) {
      const rows = await sql("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]);
      return (rows[0] as Row) ?? null;
    },
    async countUsers() {
      const rows = await sql("SELECT COUNT(*)::int AS n FROM users", []);
      return Number((rows[0] as Row)?.n ?? 0);
    },
    async createUser(u) {
      const id = u.id || uid("u_");
      await sql(
        "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING",
        [id, u.email, u.name, u.password_hash, u.role || "user"],
      );
      const rows = await sql("SELECT * FROM users WHERE email = $1 LIMIT 1", [u.email]);
      return (rows[0] as Row) ?? { id, email: u.email };
    },

    async listDocuments(ownerId, opts) {
      const q = opts?.includeDeleted
        ? "SELECT * FROM documents WHERE owner_id = $1 ORDER BY updated_at DESC"
        : "SELECT * FROM documents WHERE owner_id = $1 AND deleted = FALSE ORDER BY updated_at DESC";
      const rows = await sql(q, [ownerId]);
      return (rows as Row[]).map(normalizeDoc);
    },
    async getDocument(ownerId, id) {
      const rows = await sql("SELECT * FROM documents WHERE owner_id = $1 AND id = $2 LIMIT 1", [ownerId, id]);
      return rows[0] ? normalizeDoc(rows[0] as Row) : null;
    },
    async documentsChangedSince(ownerId, since) {
      const rows = await sql(
        "SELECT * FROM documents WHERE owner_id = $1 AND updated_at > to_timestamp($2 / 1000.0) ORDER BY updated_at ASC",
        [ownerId, since],
      );
      return (rows as Row[]).map(normalizeDoc);
    },
    async upsertDocuments(docs) {
      const out: DocRecord[] = [];
      for (const d of docs) {
        const merged = normalizeDoc({ ...blankDoc(), ...d } as Row);
        const cols = [...DOC_COLUMNS];
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
        const updates = cols
          .filter((c) => c !== "id" && c !== "created_at")
          .map((c) => `${c} = EXCLUDED.${c}`)
          .join(", ");
        const values = cols.map((c) => {
          const v = (merged as unknown as Row)[c];
          if (c === "key_points" || c === "entities" || c === "tags") return JSON.stringify(v ?? (c === "entities" ? {} : []));
          if (typeof v === "boolean") return v;
          if (v == null) return null;
          if (c === "size_bytes" || c === "rev" || c === "confidence") return Number(v);
          return v as string;
        });
        await sql(
          `INSERT INTO documents (${cols.join(",")}) VALUES (${placeholders})
           ON CONFLICT (id) DO UPDATE SET ${updates}`,
          values,
        );
        out.push(merged);
      }
      return out;
    },
    async deleteDocument(ownerId, id) {
      await sql(
        "UPDATE documents SET deleted = TRUE, rev = rev + 1, updated_at = now() WHERE owner_id = $1 AND id = $2",
        [ownerId, id],
      );
    },

    async listParams(ownerId) {
      const rows = await sql(
        "SELECT * FROM params WHERE owner_id = $1 ORDER BY kind, position, name",
        [ownerId],
      );
      return (rows as Row[]).map((r) => ({
        ...r,
        keywords: parseMaybe(r.keywords, []),
        patterns: parseMaybe(r.patterns, []),
      }));
    },
    async upsertParams(params) {
      for (const p of params) {
        await sql(
          `INSERT INTO params (id, owner_id, kind, name, slug, keywords, patterns, color, position, archived)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (owner_id, kind, slug) DO UPDATE SET
             name = EXCLUDED.name, keywords = EXCLUDED.keywords, patterns = EXCLUDED.patterns,
             color = EXCLUDED.color, position = EXCLUDED.position, archived = EXCLUDED.archived,
             updated_at = now()`,
          [
            p.id || uid("p_"),
            p.owner_id,
            p.kind,
            p.name,
            p.slug,
            JSON.stringify(p.keywords || []),
            JSON.stringify(p.patterns || []),
            p.color || "",
            Number(p.position ?? 0),
            Boolean(p.archived ?? false),
          ],
        );
      }
    },
    async deleteParam(ownerId, id) {
      await sql("DELETE FROM params WHERE owner_id = $1 AND id = $2", [ownerId, id]);
    },

    async getSettings(ownerId) {
      const rows = await sql("SELECT * FROM settings WHERE owner_id = $1 LIMIT 1", [ownerId]);
      const r = rows[0] as Row | undefined;
      return { owner_id: ownerId, data: parseMaybe(r?.data, {}), updated_at: toISO(r?.updated_at) };
    },
    async saveSettings(ownerId, data) {
      await sql(
        `INSERT INTO settings (owner_id, data, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (owner_id) DO UPDATE SET data = $2, updated_at = now()`,
        [ownerId, JSON.stringify(data)],
      );
    },

    async saveLocalFile() {
      throw new Error("El almacenamiento local de archivos no esta disponible con Neon; configura BLOB_READ_WRITE_TOKEN.");
    },
    async readLocalFile() {
      return null;
    },
  };
}

function parseMaybe(v: unknown, fb: unknown) {
  if (v == null) return fb;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fb;
  }
}

/* ----------------------------- Local JSON ------------------------- */

function blankDoc(): Row {
  return {
    id: "", owner_id: "", title: "", file_name: "", mime_type: "", size_bytes: 0,
    file_url: null, file_key: null, text_content: "", summary: "", key_points: [], entities: {},
    doc_type: "", folder: "", area: "", priority: "", status: "archivado", sender: "", recipient: "",
    doc_number: "", received_on: null, due_on: null, doc_date: null, needs_response: false,
    response_hint: "", confidence: 0, tags: [], response_draft: "", response_sent_at: null,
    notes: "", rev: 1, deleted: false, created_at: nowISO(), updated_at: nowISO(),
  };
}

function makeLocalStore(): Store {
  const writable = ensureDirs();
  const requireWritable = () => {
    if (!writable) throw new Error(READ_ONLY_MESSAGE);
  };
  return {
    kind: "local",
    readOnly: !writable,

    async getUserByEmail(email) {
      const db = readLocal();
      return db.users.find((u) => String(u.email).toLowerCase() === email.toLowerCase()) ?? null;
    },
    async getUserById(id) {
      const db = readLocal();
      return db.users.find((u) => u.id === id) ?? null;
    },
    async countUsers() {
      return readLocal().users.length;
    },
    async createUser(u) {
      requireWritable();
      const db = readLocal();
      const row = {
        id: u.id || uid("u_"),
        email: u.email,
        name: u.name,
        password_hash: u.password_hash,
        role: u.role || "user",
        created_at: nowISO(),
      };
      db.users.push(row);
      await writeLocal(db);
      return row;
    },

    async listDocuments(ownerId, opts) {
      const db = readLocal();
      return db.documents
        .filter((d) => d.owner_id === ownerId && (opts?.includeDeleted ? true : !d.deleted))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map(normalizeDoc);
    },
    async getDocument(ownerId, id) {
      const db = readLocal();
      const d = db.documents.find((x) => x.owner_id === ownerId && x.id === id);
      return d ? normalizeDoc(d) : null;
    },
    async documentsChangedSince(ownerId, since) {
      const db = readLocal();
      return db.documents
        .filter((d) => d.owner_id === ownerId && new Date(String(d.updated_at)).getTime() > since)
        .map(normalizeDoc);
    },
    async upsertDocuments(docs) {
      requireWritable();
      const db = readLocal();
      const out: DocRecord[] = [];
      for (const d of docs) {
        const merged = { ...blankDoc(), ...d } as Row;
        const i = db.documents.findIndex((x) => x.id === merged.id);
        if (i >= 0) db.documents[i] = merged;
        else db.documents.push(merged);
        out.push(normalizeDoc(merged));
      }
      await writeLocal(db);
      return out;
    },
    async deleteDocument(ownerId, id) {
      requireWritable();
      const db = readLocal();
      const d = db.documents.find((x) => x.owner_id === ownerId && x.id === id);
      if (d) {
        d.deleted = true;
        d.rev = Number(d.rev || 1) + 1;
        d.updated_at = nowISO();
      }
      await writeLocal(db);
    },

    async listParams(ownerId) {
      const db = readLocal();
      return db.params
        .filter((p) => p.owner_id === ownerId)
        .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || Number(a.position) - Number(b.position));
    },
    async upsertParams(params) {
      requireWritable();
      const db = readLocal();
      for (const p of params) {
        const i = db.params.findIndex(
          (x) => x.owner_id === p.owner_id && x.kind === p.kind && x.slug === p.slug,
        );
        const row = { id: p.id || uid("p_"), created_at: nowISO(), updated_at: nowISO(), ...p };
        if (i >= 0) db.params[i] = { ...db.params[i], ...row, id: (db.params[i].id as string) || row.id };
        else db.params.push(row);
      }
      await writeLocal(db);
    },
    async deleteParam(ownerId, id) {
      requireWritable();
      const db = readLocal();
      db.params = db.params.filter((p) => !(p.owner_id === ownerId && p.id === id));
      await writeLocal(db);
    },

    async getSettings(ownerId) {
      const db = readLocal();
      const s = db.settings.find((x) => x.owner_id === ownerId);
      return { owner_id: ownerId, data: (s?.data as Row) || {}, updated_at: toISO(s?.updated_at) };
    },
    async saveSettings(ownerId, data) {
      requireWritable();
      const db = readLocal();
      const i = db.settings.findIndex((x) => x.owner_id === ownerId);
      const row = { owner_id: ownerId, data, updated_at: nowISO() };
      if (i >= 0) db.settings[i] = row;
      else db.settings.push(row);
      await writeLocal(db);
    },

    async saveLocalFile(key, buf, mime) {
      requireWritable();
      ensureDirs();
      const safe = key.replace(/[^a-zA-Z0-9._\-/]/g, "_");
      const full = path.join(UPLOAD_DIR, safe);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, buf);
      fs.writeFileSync(full + ".meta", JSON.stringify({ mime }), "utf8");
      return `/api/files/${safe}`;
    },
    async readLocalFile(key) {
      const safe = key.replace(/[^a-zA-Z0-9._\-/]/g, "_");
      const full = path.join(UPLOAD_DIR, safe);
      if (!fs.existsSync(full)) return null;
      let mime = "application/octet-stream";
      try {
        mime = JSON.parse(fs.readFileSync(full + ".meta", "utf8")).mime || mime;
      } catch {
        /* ignore */
      }
      return { buf: fs.readFileSync(full), mime };
    },
  };
}

/* ------------------------------ fabrica --------------------------- */

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  cached = url && url.startsWith("postgres") ? makeNeonStore(url) : makeLocalStore();
  return cached;
}

export function isNeonConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgres"));
}
