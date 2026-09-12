"use client";

import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { daysUntil, formatMX } from "@/lib/summary-engine";
import type { LocalParam } from "@/lib/localdb";
import type { DocRecord } from "@/lib/schema-defs";
import { DOC_STATUSES, PRIORITIES } from "@/lib/schema-defs";

interface Props {
  docs: DocRecord[];
  params: LocalParam[];
  folder: string;
  status: string;
  onOpen: (id: string) => void;
  onStatusFilter: (status: string) => void;
  onFolderFilter: (folder: string) => void;
  onNew: () => void;
}

type Sort = "recientes" | "antiguos" | "limite" | "titulo" | "prioridad";

export function DocsView({ docs, params, folder, status, onOpen, onStatusFilter, onFolderFilter, onNew }: Props) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<Sort>("recientes");

  const tipos = params.filter((p) => p.kind === "tipo");
  const carpetas = params.filter((p) => p.kind === "carpeta");

  const nameOf = (kind: string, slug: string) => params.find((p) => p.kind === kind && p.slug === slug)?.name || slug || "—";
  const colorOf = (slug: string) => carpetas.find((c) => c.slug === slug)?.color || "";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = docs.filter((d) => !d.deleted);
    if (folder) list = list.filter((d) => d.folder === folder);
    if (type) list = list.filter((d) => d.doc_type === type);
    if (status === "vencidos") {
      list = list.filter((d) => d.due_on && (daysUntil(d.due_on) ?? 0) < 0 && d.status !== "respondido");
    } else if (status === "por_responder") {
      list = list.filter((d) => d.needs_response && d.status === "por_responder");
    } else if (status) {
      list = list.filter((d) => d.status === status);
    }
    if (needle) {
      list = list.filter((d) =>
        [d.title, d.summary, d.sender, d.recipient, d.doc_number, d.notes, d.file_name, (d.key_points || []).join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    const byPriority = (p: string) => (p === "alta" ? 0 : p === "media" ? 1 : 2);
    switch (sort) {
      case "antiguos":
        return [...list].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
      case "limite":
        return [...list].sort((a, b) => (a.due_on || "9999").localeCompare(b.due_on || "9999"));
      case "titulo":
        return [...list].sort((a, b) => (a.title || "").localeCompare(b.title || "", "es"));
      case "prioridad":
        return [...list].sort(
          (a, b) => byPriority(a.priority) - byPriority(b.priority) || (b.updated_at || "").localeCompare(a.updated_at || ""),
        );
      default:
        return [...list].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    }
  }, [docs, folder, type, status, q, sort]);

  const activeFilters = Boolean(folder || status || type || q);
  const title = folder
    ? nameOf("carpeta", folder)
    : status === "por_responder"
      ? "Por responder"
      : status === "vencidos"
        ? "Plazo vencido"
        : status
          ? DOC_STATUSES.find((s) => s.slug === status)?.name || "Archivo"
          : "Todos los documentos";

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">
            {filtered.length} documento{filtered.length === 1 ? "" : "s"}
            {activeFilters ? " con los filtros aplicados" : " archivados"}
          </p>
        </div>
        <button className="btn primary" onClick={onNew}>
          <Icon name="plus" size={15} /> Subir
        </button>
      </div>

      <div className="toolbar">
        <div className="grow" style={{ position: "relative" }}>
          <input
            className="input"
            placeholder="Buscar por título, resumen, folio o remitente…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
          <span style={{ position: "absolute", left: 10, top: 9, color: "var(--text-3)" }}>
            <Icon name="search" size={15} />
          </span>
        </div>
        <select className="select" style={{ maxWidth: 180 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos los tipos</option>
          {tipos.map((t) => (
            <option key={t.id} value={t.slug}>{t.name}</option>
          ))}
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={status} onChange={(e) => onStatusFilter(e.target.value)}>
          <option value="">Todos los estatus</option>
          {DOC_STATUSES.map((s) => (
            <option key={s.slug} value={s.slug}>{s.name}</option>
          ))}
          <option value="vencidos">Plazo vencido</option>
        </select>
        <select className="select" style={{ maxWidth: 165 }} value={folder} onChange={(e) => onFolderFilter(e.target.value)}>
          <option value="">Todas las carpetas</option>
          {carpetas.map((c) => (
            <option key={c.id} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recientes">Mas recientes</option>
          <option value="antiguos">Mas antiguos</option>
          <option value="limite">Por fecha limite</option>
          <option value="prioridad">Por prioridad</option>
          <option value="titulo">Por titulo (A-Z)</option>
        </select>
        {activeFilters && (
          <button
            className="btn ghost sm"
            onClick={() => {
              setQ("");
              setType("");
              onStatusFilter("");
              onFolderFilter("");
            }}
          >
            <Icon name="close" size={13} /> Limpiar
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <div className="big">{activeFilters ? "Sin resultados con estos filtros" : "Todavia no hay documentos"}</div>
          <div>
            {activeFilters
              ? "Prueba con otra búsqueda o limpia los filtros."
              : "Sube el primero y obtendras su resumen y clasificación al instante."}
          </div>
        </div>
      ) : (
        <>
          <div className="table-wrap hide-mobile">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Tipo</th>
                  <th>Carpeta</th>
                  <th>Prioridad</th>
                  <th>Estatus</th>
                  <th>Limite</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const days = daysUntil(d.due_on);
                  return (
                    <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => onOpen(d.id)}>
                      <td>
                        <div style={{ fontWeight: 600, marginBottom: 3, maxWidth: 460 }}>{d.title || d.file_name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {d.sender ? `${d.sender} · ` : ""}
                          {d.doc_number ? `${d.doc_number} · ` : ""}
                          {formatMX(d.received_on || (d.created_at || "").slice(0, 10))}
                        </div>
                      </td>
                      <td className="nowrap">{nameOf("tipo", d.doc_type)}</td>
                      <td className="nowrap">
                        <span className="row" style={{ gap: 6 }}>
                          <span className="folder-dot" style={{ background: colorOf(d.folder) }} />
                          {nameOf("carpeta", d.folder)}
                        </span>
                      </td>
                      <td><PriorityBadge p={d.priority} /></td>
                      <td><StatusBadge s={d.status} needs={d.needs_response} /></td>
                      <td className="nowrap">
                        {d.due_on ? (
                          <span
                            style={{
                              color:
                                days !== null && days < 0
                                  ? "var(--danger)"
                                  : days !== null && days <= 7
                                    ? "var(--warn)"
                                    : "var(--text-2)",
                            }}
                          >
                            {formatMX(d.due_on)}
                            {days !== null && d.status !== "respondido" && (
                              <span className="muted"> {days < 0 ? `(${Math.abs(days)} d de retraso)` : `(en ${days} d)`}</span>
                            )}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="list hide-desktop">
            {filtered.map((d) => {
              const days = daysUntil(d.due_on);
              return (
                <button key={d.id} className="doc-item" onClick={() => onOpen(d.id)}>
                  <div className="ttl">{d.title || d.file_name}</div>
                  <div className="chips" style={{ marginBottom: 6 }}>
                    <span className="chip">
                      <span className="folder-dot" style={{ background: colorOf(d.folder) }} />
                      {nameOf("carpeta", d.folder)}
                    </span>
                    <PriorityBadge p={d.priority} />
                    <StatusBadge s={d.status} needs={d.needs_response} />
                  </div>
                  <div className="meta">
                    <span>{nameOf("tipo", d.doc_type)}</span>
                    {d.sender && <span>{d.sender}</span>}
                    {d.due_on && (
                      <span style={{ color: days !== null && days < 0 ? "var(--danger)" : "inherit" }}>
                        Limite {formatMX(d.due_on)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

export function PriorityBadge({ p }: { p: string }) {
  const meta = PRIORITIES.find((x) => x.slug === p);
  if (!meta) return <span className="muted">—</span>;
  const cls = p === "alta" ? "badge alert" : p === "media" ? "badge warn" : "badge muted";
  return <span className={cls}>{meta.name}</span>;
}

export function StatusBadge({ s, needs }: { s: string; needs: boolean }) {
  const meta = DOC_STATUSES.find((x) => x.slug === s);
  const label = meta?.name || s || "—";
  const cls =
    s === "por_responder" && needs ? "badge alert" : s === "respondido" ? "badge ok" : s === "en_proceso" ? "badge warn" : "badge muted";
  return <span className={cls}>{label}</span>;
}
