import { randomUUID } from "crypto";

export function uid(prefix = ""): string {
  return prefix + randomUUID().replace(/-/g, "").slice(0, 20);
}

/** Normaliza texto para comparaciones: minusculas y sin acentos. */
export function fold(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Slug ASCII seguro para URL y nombres de archivo. */
export function slugify(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "sin-titulo";
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
