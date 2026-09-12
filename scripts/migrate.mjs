/**
 * Aplica scripts/schema.sql en la base Neon indicada por DATABASE_URL.
 * Uso: npm run db:migrate
 */
import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL. Copia .env.example a .env.local y pega tu string de conexion de Neon.");
  process.exit(1);
}

const file = path.join(process.cwd(), "scripts", "schema.sql");
const sql = fs.readFileSync(file, "utf8");

// divide por sentencias (el esquema no usa funciones ni $$)
const statements = sql
  .split(/;\s*[\r\n]/)
  .map((s) => s.replace(/--.*$/gm, "").trim())
  .filter(Boolean);

const client = neon(url);
let ok = 0;
for (const stmt of statements) {
  try {
    await client.query(stmt);
    ok++;
  } catch (e) {
    console.error("Fallo esta sentencia:\n" + stmt.slice(0, 160) + "\n", e.message);
    process.exit(1);
  }
}
console.log(`Migracion aplicada: ${ok} sentencias ejecutadas en Neon.`);
