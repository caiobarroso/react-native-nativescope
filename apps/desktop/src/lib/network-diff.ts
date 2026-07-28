/**
 * Diff estrutural entre dois valores JSON — a base do modo "Only Changes"
 * (experiência git-like) do diff de responses do módulo de Network.
 *
 * O modo "Side by Side" reusa o createValueInlineDiff de json-diff.ts (o mesmo
 * realce do storage). Aqui ficam só os campos que MUDARAM, achatados por path.
 */

export interface FieldDiff {
  /** Caminho achatado, ex.: "user.name" ou "items[3].price". */
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(before: unknown, after: unknown, path: string, out: FieldDiff[]): void {
  if (Object.is(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i += 1) {
      const childPath = `${path}[${i}]`;
      if (i >= before.length) out.push({ path: childPath, kind: "added", after: after[i] });
      else if (i >= after.length) out.push({ path: childPath, kind: "removed", before: before[i] });
      else walk(before[i], after[i], childPath, out);
    }
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in before)) out.push({ path: childPath, kind: "added", after: after[key] });
      else if (!(key in after)) out.push({ path: childPath, kind: "removed", before: before[key] });
      else walk(before[key], after[key], childPath, out);
    }
    return;
  }

  out.push({ path: path || "(root)", kind: "changed", before, after });
}

/** Lista achatada dos campos que diferem entre dois valores JSON. */
export function diffJson(before: unknown, after: unknown): FieldDiff[] {
  const out: FieldDiff[] = [];
  walk(before, after, "", out);
  return out;
}

/** Parse tolerante de um corpo textual: JSON quando possível, senão o texto cru. */
export function parseBody(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Representação curta de um valor para a lista de mudanças. */
export function shortValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return String(value);
  const json = JSON.stringify(value);
  return json.length > 80 ? `${json.slice(0, 80)}…` : json;
}
