import type { NetworkRequest } from "@rnsi/protocol";
import { generateTypeScript } from "../components/ValueEditor.tsx";

/**
 * Exporta uma request capturada para formatos que o dev cola direto no código,
 * doc ou terminal. O JSON viewer e o gerador de TypeScript são os MESMOS do
 * módulo de storage (generateTypeScript) — uma interface só.
 */

export type ExportFormat = "curl" | "fetch" | "axios" | "json" | "typescript";

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: "curl", label: "cURL" },
  { id: "fetch", label: "Fetch" },
  { id: "axios", label: "Axios" },
  { id: "json", label: "JSON" },
  { id: "typescript", label: "TypeScript" },
];

export function exportRequest(request: NetworkRequest, format: ExportFormat): string {
  switch (format) {
    case "curl":
      return toCurl(request);
    case "fetch":
      return toFetch(request);
    case "axios":
      return toAxios(request);
    case "json":
      return toJson(request);
    case "typescript":
      return toTypeScript(request);
  }
}

/** Aspas simples seguras para shell: fecha, escapa, reabre. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function bodyText(request: NetworkRequest): string | null {
  const text = request.requestBody?.text;
  return text && text.length > 0 ? text : null;
}

function truncationNote(request: NetworkRequest, comment: string): string {
  return request.requestBody?.truncated ? `${comment} request body truncated to preview\n` : "";
}

function toCurl(request: NetworkRequest): string {
  const lines = [`curl -X ${request.method} ${shellQuote(request.url)}`];
  for (const [name, value] of Object.entries(request.requestHeaders)) {
    lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }
  const body = bodyText(request);
  if (body !== null) lines.push(`  --data ${shellQuote(body)}`);
  return truncationNote(request, "#") + lines.join(" \\\n");
}

function toFetch(request: NetworkRequest): string {
  const init: string[] = [`  method: ${JSON.stringify(request.method)},`];
  const headers = Object.entries(request.requestHeaders);
  if (headers.length > 0) {
    init.push("  headers: {");
    for (const [name, value] of headers) init.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
    init.push("  },");
  }
  const body = bodyText(request);
  if (body !== null) init.push(`  body: ${JSON.stringify(body)},`);
  return (
    truncationNote(request, "//") +
    `await fetch(${JSON.stringify(request.url)}, {\n${init.join("\n")}\n});`
  );
}

function toAxios(request: NetworkRequest): string {
  const config: string[] = [
    `  method: ${JSON.stringify(request.method.toLowerCase())},`,
    `  url: ${JSON.stringify(request.url)},`,
  ];
  const headers = Object.entries(request.requestHeaders);
  if (headers.length > 0) {
    config.push("  headers: {");
    for (const [name, value] of headers) config.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
    config.push("  },");
  }
  const body = bodyText(request);
  if (body !== null) {
    // Se o corpo é JSON válido, emite o objeto (axios serializa); senão, string.
    let dataLiteral = JSON.stringify(body);
    try {
      dataLiteral = JSON.stringify(JSON.parse(body), null, 2)
        .split("\n")
        .map((line, index) => (index === 0 ? line : `  ${line}`))
        .join("\n");
    } catch {
      /* corpo não-JSON: mantém como string */
    }
    config.push(`  data: ${dataLiteral},`);
  }
  return truncationNote(request, "//") + `await axios({\n${config.join("\n")}\n});`;
}

function parseMaybeJson(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toJson(request: NetworkRequest): string {
  return JSON.stringify(
    {
      method: request.method,
      url: request.url,
      status: request.status,
      requestHeaders: request.requestHeaders,
      requestBody: parseMaybeJson(request.requestBody?.text),
      response: {
        status: request.status,
        headers: request.responseHeaders,
        body: parseMaybeJson(request.responseBody?.text),
      },
    },
    null,
    2,
  );
}

function toTypeScript(request: NetworkRequest): string {
  // Tipa o corpo da RESPONSE (a necessidade comum: colar o tipo no código).
  const response = request.responseBody?.text;
  const value = parseMaybeJson(response);
  if (value === null || typeof value !== "object") {
    return "// No JSON response body to derive a type from.";
  }
  const note = request.responseBody?.truncated
    ? "// Note: response body was truncated to preview — type may be incomplete.\n"
    : "";
  return note + generateTypeScript(value, request.path, { declaration: "interface", arrayStyle: "array" });
}
