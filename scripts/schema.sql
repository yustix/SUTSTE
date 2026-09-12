-- ============================================================
-- SUT STE - Esquema Neon / PostgreSQL
-- Ejecutar:  npm run db:migrate
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  file_name      TEXT NOT NULL DEFAULT '',
  mime_type      TEXT NOT NULL DEFAULT '',
  size_bytes     BIGINT NOT NULL DEFAULT 0,
  file_url       TEXT,
  file_key       TEXT,
  text_content   TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  key_points     JSON NOT NULL DEFAULT '[]',
  entities       JSON NOT NULL DEFAULT '{}',
  doc_type       TEXT NOT NULL DEFAULT '',
  folder         TEXT NOT NULL DEFAULT '',
  area           TEXT NOT NULL DEFAULT '',
  priority       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'archivado',
  sender         TEXT NOT NULL DEFAULT '',
  recipient      TEXT NOT NULL DEFAULT '',
  doc_number     TEXT NOT NULL DEFAULT '',
  received_on    TEXT,
  due_on         TEXT,
  doc_date       TEXT,
  needs_response BOOLEAN NOT NULL DEFAULT FALSE,
  response_hint  TEXT NOT NULL DEFAULT '',
  confidence     NUMERIC(4,3) NOT NULL DEFAULT 0,
  tags           JSON NOT NULL DEFAULT '[]',
  response_draft TEXT NOT NULL DEFAULT '',
  response_sent_at TIMESTAMPTZ,
  notes          TEXT NOT NULL DEFAULT '',
  rev            INTEGER NOT NULL DEFAULT 1,
  deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_owner_updated ON documents (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_folder        ON documents (owner_id, folder);
CREATE INDEX IF NOT EXISTS idx_documents_type          ON documents (owner_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_status        ON documents (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_needs         ON documents (owner_id, needs_response);

CREATE TABLE IF NOT EXISTS params (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  keywords   JSON NOT NULL DEFAULT '[]',
  patterns   JSON NOT NULL DEFAULT '[]',
  color      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  archived   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, kind, slug)
);

CREATE INDEX IF NOT EXISTS idx_params_owner ON params (owner_id, kind);

CREATE TABLE IF NOT EXISTS settings (
  owner_id TEXT PRIMARY KEY,
  data     JSON NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
