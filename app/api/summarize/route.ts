import { NextResponse } from "next/server";
import { badRequest, readJson, requireUser, serverError } from "@/lib/api-helpers";
import { analyzeText } from "@/lib/summary-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Resumen con IA (opcional).
 *
 * Por defecto SUT STE resume con el motor local, en el navegador. Esta ruta es
 * para quien prefiera un resumen generativo: define en Vercel
 *
 *   LLM_PROVIDER=openai | gemini | openrouter
 *   LLM_API_KEY=...
 *   LLM_MODEL=...            (opcional)
 *
 * El motor local sigue calculando entidades, fechas y montos; la IA solo
 * redacta el resumen y los puntos clave sobre ese mismo texto.
 */

type Provider = "openai" | "gemini" | "openrouter";

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  openrouter: "openai/gpt-4o-mini",
};

const MAX_CHARS = 14000;

const INSTRUCTIONS = [
  "Eres un analista documental de una oficina sindical en Mexico.",
  "Escribe en espanol neutro, sin emojis, sin adjetivos de mas y sin inventar datos que no esten en el texto.",
  "Responde unicamente con un JSON valido, sin bloques de codigo, con esta forma exacta:",
  '{"summary":"resumen de 3 a 5 oraciones","keyPoints":["punto breve"],"needsResponse":true,"responseHint":"por que conviene responder o solo archivar"}',
].join(" ");

interface LlmResult {
  summary?: string;
  keyPoints?: unknown;
  needsResponse?: unknown;
  responseHint?: unknown;
}

function parseJson(text: string): LlmResult | null {
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1)) as LlmResult;
  } catch {
    return null;
  }
}

async function callLlm(provider: Provider, apiKey: string, model: string, document: string): Promise<string> {
  const userContent = `Documento a resumir:\n\n${document}`;

  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) throw new Error(`El proveedor respondió ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  }

  const url = provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`El proveedor respondió ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content || "";
}

export async function POST(req: Request) {
  try {
    const r = await requireUser();
    if ("error" in r) return r.error;

    const provider = (process.env.LLM_PROVIDER || "").toLowerCase() as Provider;
    const apiKey = process.env.LLM_API_KEY || "";
    if (!provider || !apiKey || !DEFAULT_MODELS[provider]) {
      return NextResponse.json(
        {
          error:
            "El resumen con IA no está configurado. Define LLM_PROVIDER (openai, gemini u openrouter) y LLM_API_KEY, o usa el motor local.",
        },
        { status: 501 },
      );
    }

    const body = await readJson<{ text?: string; fileName?: string }>(req);
    const text = String(body.text || "").trim();
    if (text.length < 80) return badRequest("El texto es demasiado corto para resumirlo.");

    const model = process.env.LLM_MODEL || DEFAULT_MODELS[provider];
    const local = analyzeText(text, { fileName: body.fileName });

    let raw = "";
    try {
      raw = await callLlm(provider, apiKey, model, text.slice(0, MAX_CHARS));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "No se pudo consultar al proveedor de IA.", fallback: "local" },
        { status: 502 },
      );
    }

    const llm = parseJson(raw);
    if (!llm) {
      return NextResponse.json(
        { error: "La respuesta del modelo no fue un JSON válido.", fallback: "local" },
        { status: 502 },
      );
    }

    const keyPoints = Array.isArray(llm.keyPoints) ? llm.keyPoints.map((k) => String(k)).filter(Boolean).slice(0, 8) : [];

    return NextResponse.json({
      ...local,
      summary: typeof llm.summary === "string" && llm.summary.trim() ? llm.summary.trim() : local.summary,
      keyPoints: keyPoints.length ? keyPoints : local.keyPoints,
      needsResponse: typeof llm.needsResponse === "boolean" ? llm.needsResponse : local.needsResponse,
      responseHint: typeof llm.responseHint === "string" && llm.responseHint.trim() ? llm.responseHint.trim() : local.responseHint,
      engine: "llm",
      provider,
      model,
    });
  } catch (e) {
    return serverError(e);
  }
}
