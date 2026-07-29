/**
 * Geração de tipos TypeScript a partir de um valor JSON. Puro (sem React) —
 * extraído do ValueEditor para ser reusado pelo módulo de Network (export
 * "TypeScript") e testado isoladamente. Uma interface só entre storage e network.
 */

export type TsDeclaration = "interface" | "type";
export type TsArrayStyle = "array" | "bracket";

export interface TypeScriptOptions {
  declaration: TsDeclaration;
  arrayStyle: TsArrayStyle;
}

export function typeNameFromKey(name: string | undefined): string {
  const words = (name ?? "StorageValue")
    .replace(/\[[^\]]*\]/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const candidate = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
  if (!candidate) return "StorageValue";
  return /^\d/.test(candidate) ? `Storage${candidate}` : candidate;
}

function safePropertyName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

export function generateTypeScript(
  value: unknown,
  rootName: string,
  options: TypeScriptOptions,
): string {
  const normalizedRoot = typeNameFromKey(rootName);
  if (options.declaration === "interface" && isPlainObject(value)) {
    return `export interface ${normalizedRoot} ${inferObjectType(value, 0, options)}\n`;
  }
  if (options.declaration === "interface" && Array.isArray(value)) {
    return `export interface ${normalizedRoot} extends Array<${inferArrayItemType(value, 0, options)}> {}\n`;
  }
  return `export type ${normalizedRoot} = ${inferTsType(value, 0, options)};\n`;
}

function inferTsType(value: unknown, level: number, options: TypeScriptOptions): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return inferArrayType(value, level, options);
  if (isPlainObject(value)) return inferObjectType(value, level, options);
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "number" : "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

function inferArrayType(values: unknown[], level: number, options: TypeScriptOptions): string {
  return arrayOf(inferArrayItemType(values, level, options), options);
}

function inferArrayItemType(values: unknown[], level: number, options: TypeScriptOptions): string {
  if (values.length === 0) return "unknown";

  const objectValues = values.filter(isPlainObject);
  const nonObjectValues = values.filter((value) => !isPlainObject(value));
  const members = new Set<string>();

  if (objectValues.length > 0) {
    members.add(inferMergedObjectType(objectValues, level, options));
  }
  for (const value of nonObjectValues) {
    members.add(Array.isArray(value) ? inferArrayType(value, level, options) : inferTsType(value, level, options));
  }

  return union([...members]);
}

function inferObjectType(
  value: Record<string, unknown>,
  level: number,
  options: TypeScriptOptions,
  optionalKeys = new Set<string>(),
): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "Record<string, never>";

  const pad = indent(level);
  const childPad = indent(level + 1);
  const lines = entries.map(([key, child]) => {
    const optional = optionalKeys.has(key) ? "?" : "";
    return `${childPad}${safePropertyName(key)}${optional}: ${inferTsType(child, level + 1, options)};`;
  });
  return `{\n${lines.join("\n")}\n${pad}}`;
}

function inferMergedObjectType(
  values: Array<Record<string, unknown>>,
  level: number,
  options: TypeScriptOptions,
): string {
  const keys = [...new Set(values.flatMap((value) => Object.keys(value)))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (keys.length === 0) return "Record<string, never>";

  const pad = indent(level);
  const childPad = indent(level + 1);
  const lines = keys.map((key) => {
    const present = values.filter((value) => Object.hasOwn(value, key));
    const optional = present.length < values.length ? "?" : "";
    const type = inferUnionValues(present.map((value) => value[key]), level + 1, options);
    return `${childPad}${safePropertyName(key)}${optional}: ${type};`;
  });
  return `{\n${lines.join("\n")}\n${pad}}`;
}

function inferUnionValues(values: unknown[], level: number, options: TypeScriptOptions): string {
  const types = new Set(values.map((value) => inferTsType(value, level, options)));
  return union([...types]);
}

function union(types: string[]): string {
  const unique = [...new Set(types)];
  if (unique.length === 0) return "unknown";
  if (unique.length === 1) return unique[0] ?? "unknown";
  return unique.sort().join(" | ");
}

function arrayOf(itemType: string, options: TypeScriptOptions): string {
  const needsParens = itemType.includes(" | ");
  if (options.arrayStyle === "array") return `Array<${itemType}>`;
  return `${needsParens ? `(${itemType})` : itemType}[]`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indent(level: number): string {
  return "  ".repeat(level);
}
