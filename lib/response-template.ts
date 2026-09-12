"use client";

import { formatMX } from "./summary-engine";
import type { DocRecord } from "./schema-defs";

export interface OrgInfo {
  name?: string;
  area?: string;
  responsible?: string;
  city?: string;
}

/**
 * Genera un borrador de respuesta a partir de los datos detectados.
 * Es una plantilla editable: la redaccion final la decide el usuario.
 */
export function buildResponseDraft(doc: DocRecord, org: OrgInfo = {}): string {
  const today = new Date();
  const lugar = org.city || "";
  const fecha = `${formatMX(today.toISOString().slice(0, 10))}`;

  const destinatario = doc.sender || doc.recipient || "[Nombre del destinatario]";
  const cargo = org.responsible || "[Cargo]";
  const referencia = doc.doc_number ? `Oficio o folio: ${doc.doc_number}` : "";
  const asunto = doc.title || "Respuesta a su comunicación";

  const peticion = detectarPeticion(doc);

  const lines: string[] = [];
  if (lugar) lines.push(`${lugar}, a ${fecha}.`);
  else lines.push(`A ${fecha}.`);
  lines.push("");
  if (referencia) lines.push(referencia);
  lines.push(`Asunto: ${asunto}.`);
  lines.push("");
  lines.push(`${destinatario.toUpperCase()}`);
  lines.push("PRESENTE.");
  lines.push("");
  lines.push(
    `Por medio del presente, y en atención a su comunicación${
      doc.doc_number ? ` identificada con el ${doc.doc_number}` : ""
    }${doc.doc_date ? ` de fecha ${formatMX(doc.doc_date)}` : ""}, me permito manifestar lo siguiente:`,
  );
  lines.push("");
  lines.push(peticion);
  lines.push("");
  if (doc.due_on) {
    lines.push(
      `Lo anterior se emite dentro del plazo señalado, con fecha límite al ${formatMX(doc.due_on)}.`,
    );
    lines.push("");
  }
  lines.push(
    "Sin otro particular por el momento, quedó a sus ordenes para cualquier aclaracion al respecto.",
  );
  lines.push("");
  lines.push("ATENTAMENTE");
  lines.push("");
  lines.push("");
  lines.push("_______________________________");
  lines.push(org.name ? `${org.name}` : "[Nombre de quien firma]");
  if (org.area) lines.push(org.area);
  lines.push(cargo);

  return lines.join("\n");
}

function detectarPeticion(doc: DocRecord): string {
  const kp = (doc.key_points || []).find((k) => /^Peticion:/i.test(k));
  const base = kp
    ? kp.replace(/^Peticion:\s*/i, "")
    : doc.summary
      ? doc.summary.split(/(?<=[.])\s/)[0]
      : "";

  if (!base) {
    return "Hago referencia al contenido de su escrito, el cual fue recibido, revisado y turnado al área correspondiente para su atención.";
  }

  const texto = base.replace(/\s+/g, " ").trim().replace(/^(Se\s+)?(solicita|requiere|pide)\s*/i, "$1 ").trim();

  if (/^(se\s+)?(solicita|requiere|pide)/i.test(base)) {
    return `En relacion con la petición planteada (${lower(texto)}), le informó que [describir el acuerdo, la respuesta o la accion realizada].`;
  }
  return `Al respecto, y en relacion con lo señalado en su escrito (${lower(texto)}), le informó que [describir la respuesta o el acuerdo].`;
}

function lower(s: string): string {
  const t = s.replace(/[.;]+$/, "").trim();
  return t.charAt(0).toLowerCase() + t.slice(1);
}
