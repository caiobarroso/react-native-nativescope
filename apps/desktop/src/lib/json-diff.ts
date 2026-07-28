import type { StorageValue } from "@rnsi/protocol";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonPath = Array<string | number>;

export interface JsonDiffSegment {
  text: string;
  changed: boolean;
}

export interface JsonInlineDiff {
  before: JsonDiffSegment[];
  after: JsonDiffSegment[];
  changeCount: number;
}

interface DiffPaths {
  before: Set<string>;
  after: Set<string>;
  count: number;
}

/**
 * Produces a semantic JSON diff while preserving the complete payload on both sides.
 * Object property order is ignored; only the changed property/value pair is marked.
 */
export function createJsonInlineDiff(
  before: StorageValue | null,
  after: StorageValue | null,
): JsonInlineDiff | null {
  if (before?.type !== "json" || after?.type !== "json") return null;
  try {
    return createValueInlineDiff(JSON.parse(before.value), JSON.parse(after.value));
  } catch {
    return null;
  }
}

/**
 * Mesmo diff inline, mas sobre valores JSON já parseados — usado pelo módulo de
 * Network (comparar dois response bodies) sem passar por StorageValue.
 */
export function createValueInlineDiff(before: unknown, after: unknown): JsonInlineDiff | null {
  const beforeValue = before as JsonValue;
  const afterValue = after as JsonValue;
  const paths: DiffPaths = { before: new Set(), after: new Set(), count: 0 };
  collectDiffPaths(beforeValue, afterValue, [], paths);
  if (paths.count === 0) return null;
  return {
    before: renderJson(beforeValue, [], paths.before),
    after: renderJson(afterValue, [], paths.after),
    changeCount: paths.count,
  };
}

function collectDiffPaths(
  before: JsonValue,
  after: JsonValue,
  path: JsonPath,
  result: DiffPaths,
): void {
  if (Object.is(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const sharedLength = Math.min(before.length, after.length);
    for (let index = 0; index < sharedLength; index += 1) {
      collectDiffPaths(before[index]!, after[index]!, [...path, index], result);
    }
    for (let index = sharedLength; index < before.length; index += 1) {
      mark(result.before, [...path, index]);
      result.count += 1;
    }
    for (let index = sharedLength; index < after.length; index += 1) {
      mark(result.after, [...path, index]);
      result.count += 1;
    }
    return;
  }

  if (isJsonObject(before) && isJsonObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const childPath = [...path, key];
      if (!(key in before)) {
        mark(result.after, childPath);
        result.count += 1;
      } else if (!(key in after)) {
        mark(result.before, childPath);
        result.count += 1;
      } else {
        collectDiffPaths(before[key]!, after[key]!, childPath, result);
      }
    }
    return;
  }

  mark(result.before, path);
  mark(result.after, path);
  result.count += 1;
}

function renderJson(value: JsonValue, path: JsonPath, highlights: Set<string>): JsonDiffSegment[] {
  if (highlights.has(pathKey(path))) {
    return [{ text: JSON.stringify(value), changed: true }];
  }

  if (Array.isArray(value)) {
    const segments: JsonDiffSegment[] = [{ text: "[", changed: false }];
    value.forEach((item, index) => {
      if (index > 0) appendSegment(segments, ",", false);
      appendSegments(segments, renderJson(item, [...path, index], highlights));
    });
    appendSegment(segments, "]", false);
    return segments;
  }

  if (isJsonObject(value)) {
    const segments: JsonDiffSegment[] = [{ text: "{", changed: false }];
    Object.entries(value).forEach(([key, item], index) => {
      if (index > 0) appendSegment(segments, ",", false);
      const childPath = [...path, key];
      const changed = highlights.has(pathKey(childPath));
      if (changed) {
        appendSegment(segments, `${JSON.stringify(key)}:${JSON.stringify(item)}`, true);
      } else {
        appendSegment(segments, `${JSON.stringify(key)}:`, false);
        appendSegments(segments, renderJson(item, childPath, highlights));
      }
    });
    appendSegment(segments, "}", false);
    return segments;
  }

  return [{ text: JSON.stringify(value), changed: false }];
}

function appendSegments(target: JsonDiffSegment[], source: JsonDiffSegment[]): void {
  for (const segment of source) appendSegment(target, segment.text, segment.changed);
}

function appendSegment(target: JsonDiffSegment[], text: string, changed: boolean): void {
  const previous = target.at(-1);
  if (previous?.changed === changed) {
    previous.text += text;
  } else {
    target.push({ text, changed });
  }
}

function mark(paths: Set<string>, path: JsonPath): void {
  paths.add(pathKey(path));
}

function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
