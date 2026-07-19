import type { KeyEntry, StorageValue, ChangeSource } from "@rnsi/protocol";
import type { KeyValueAdapter, KeyValueChange } from "../adapter.ts";
import { KEY_READ_BATCH, breathe, pageOfKeys } from "../key-pagination.ts";

/**
 * Interface mínima de uma instância MMKV (react-native-mmkv v2/v3).
 * O shim passa a instância real; os testes passam o fake do testkit.
 */
export interface MMKVInstanceLike {
  getAllKeys(): readonly string[];
  contains(key: string): boolean;
  getString(key: string): string | undefined;
  getNumber(key: string): number | undefined;
  getBoolean(key: string): boolean | undefined;
  getBuffer?(key: string): ArrayBuffer | undefined;
  set(key: string, value: string | number | boolean | ArrayBuffer): void;
  delete(key: string): void;
  addOnValueChangedListener(listener: (key: string) => void): { remove(): void };
}

const PREVIEW_MAX = 120;
const ECHO_TTL_MS = 500;

/**
 * MMKV não tem introspecção de tipo: `"123"` e `123` são indistinguíveis
 * por fora. A inferência tenta string → number → boolean → buffer, nesta
 * ordem, e strings com cara de JSON válido viram type json. Por isso o
 * seletor de tipo na UI é sempre visível — mudar tipo é decisão do usuário.
 */
function readValue(instance: MMKVInstanceLike, key: string): StorageValue | null {
  const asString = instance.getString(key);
  if (asString !== undefined) {
    const trimmed = asString.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        return { type: "json", value: asString };
      } catch {
        /* string mesmo */
      }
    }
    return { type: "string", value: asString };
  }
  const asNumber = instance.getNumber(key);
  if (asNumber !== undefined) return { type: "number", value: asNumber };
  const asBoolean = instance.getBoolean(key);
  if (asBoolean !== undefined) return { type: "boolean", value: asBoolean };
  const asBuffer = instance.getBuffer?.(key);
  if (asBuffer !== undefined) {
    let base64 = "";
    const bytes = new Uint8Array(asBuffer);
    for (const b of bytes) base64 += String.fromCharCode(b);
    // btoa não existe em todo runtime RN; codificação manual simples
    return { type: "buffer", value: toBase64(base64) };
  }
  return null;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(binary: string): string {
  let out = "";
  for (let i = 0; i < binary.length; i += 3) {
    const [a, b, c] = [binary.charCodeAt(i), binary.charCodeAt(i + 1), binary.charCodeAt(i + 2)];
    const chunk = (a << 16) | ((b || 0) << 8) | (c || 0);
    out +=
      BASE64_CHARS[(chunk >> 18) & 63]! +
      BASE64_CHARS[(chunk >> 12) & 63]! +
      (Number.isNaN(b) ? "=" : BASE64_CHARS[(chunk >> 6) & 63]!) +
      (Number.isNaN(c) ? "=" : BASE64_CHARS[chunk & 63]!);
  }
  return out;
}

function toEntry(key: string, value: StorageValue): KeyEntry {
  const serialized = value.type === "null" ? "null" : String(value.value);
  return {
    key,
    valueType: value.type,
    approxSize: serialized.length,
    preview:
      serialized.length > PREVIEW_MAX ? `${serialized.slice(0, PREVIEW_MAX)}…` : serialized,
  };
}

export interface MMKVAdapter extends KeyValueAdapter {
  /** Chamado pelo shim a cada `new MMKV()`. Idempotente por id. */
  registerInstance(instanceId: string, instance: MMKVInstanceLike): void;
  /** Notifica que o Studio deve reconsiderar — usado nos testes. */
  hasInstance(instanceId: string): boolean;
}

export function createMMKVAdapter(): MMKVAdapter {
  interface Tracked {
    instance: MMKVInstanceLike;
    knownKeys: Set<string>;
    listeners: Set<(change: KeyValueChange) => void>;
    pendingStudioWrites: Map<string, number>;
    subscription: { remove(): void } | null;
  }

  const tracked = new Map<string, Tracked>();
  const registrationListeners = new Set<() => void>();

  function get(instanceId: string): Tracked {
    const t = tracked.get(instanceId);
    if (!t) throw new Error(`unknown instance: ${instanceId}`);
    return t;
  }

  function consumeStudioEcho(t: Tracked, key: string): boolean {
    const expiresAt = t.pendingStudioWrites.get(key);
    if (expiresAt !== undefined) {
      t.pendingStudioWrites.delete(key);
      if (Date.now() < expiresAt) return true;
    }
    return false;
  }

  function emit(t: Tracked, change: KeyValueChange): void {
    for (const listener of t.listeners) listener(change);
  }

  function emitChange(t: Tracked, key: string, source: ChangeSource): void {
    if (!t.instance.contains(key)) {
      if (!t.knownKeys.has(key)) return;
      t.knownKeys.delete(key);
      emit(t, { key, change: "removed", source, entry: null });
      return;
    }
    const value = readValue(t.instance, key);
    if (value === null) return;
    const change: KeyValueChange["change"] = t.knownKeys.has(key) ? "updated" : "created";
    t.knownKeys.add(key);
    emit(t, { key, change, source, entry: toEntry(key, value) });
  }

  /** O listener do MMKV dispara para QUALQUER escrita — inclusive as nossas.
   * A origem é resolvida pelo mesmo padrão de pendentes do AsyncStorage. */
  function onNativeChange(instanceId: string, key: string): void {
    const t = tracked.get(instanceId);
    if (!t) return;
    const source: ChangeSource = consumeStudioEcho(t, key) ? "studio" : "app";
    emitChange(t, key, source);
  }

  return {
    providerId: "mmkv",
    label: "MMKV",
    capabilities: ["key-value.read", "key-value.write", "key-value.watch"],

    instances() {
      return [...tracked.keys()].sort().map((instanceId) => ({
        instanceId,
        label: instanceId,
      }));
    },

    registerInstance(instanceId, instance) {
      if (tracked.has(instanceId)) return;
      const t: Tracked = {
        instance,
        knownKeys: new Set(instance.getAllKeys()),
        listeners: new Set(),
        pendingStudioWrites: new Map(),
        subscription: null,
      };
      try {
        t.subscription = instance.addOnValueChangedListener((key) =>
          onNativeChange(instanceId, key),
        );
      } catch {
        t.subscription = null; // MMKV sem listener: fallback no set/remove
      }
      tracked.set(instanceId, t);
      for (const listener of registrationListeners) listener();
    },

    hasInstance(instanceId) {
      return tracked.has(instanceId);
    },

    onInstancesChanged(listener) {
      registrationListeners.add(listener);
      return () => registrationListeners.delete(listener);
    },

    async listKeys(instanceId, options) {
      const t = get(instanceId);
      // Recorta a janela sobre os NOMES; valores só da página, em lotes
      // curtos com yield (leituras MMKV são síncronas — o yield impede que
      // uma página presa em valores grandes monopolize a JS thread).
      const { pageKeys, nextAfterKey, total } = pageOfKeys(t.instance.getAllKeys(), options);
      const entries: KeyEntry[] = [];
      for (let i = 0; i < pageKeys.length; i += KEY_READ_BATCH) {
        for (const key of pageKeys.slice(i, i + KEY_READ_BATCH)) {
          const value = readValue(t.instance, key);
          if (value !== null) {
            entries.push(toEntry(key, value));
            t.knownKeys.add(key);
          }
        }
        if (i + KEY_READ_BATCH < pageKeys.length) await breathe();
      }
      return { entries, nextAfterKey, total };
    },

    async get(instanceId, key) {
      return readValue(get(instanceId).instance, key);
    },

    async set(instanceId, key, value) {
      const t = get(instanceId);
      t.pendingStudioWrites.set(key, Date.now() + ECHO_TTL_MS);
      switch (value.type) {
        case "string":
        case "json":
          t.instance.set(key, value.value);
          break;
        case "number":
          t.instance.set(key, value.value);
          break;
        case "boolean":
          t.instance.set(key, value.value);
          break;
        case "null":
          t.instance.delete(key);
          break;
        case "buffer":
          throw new Error("escrita de buffer não suportada no MVP");
      }
      // Ao contrário do AsyncStorage, o MMKV TEM listener nativo e ele
      // dispara para qualquer escrita — inclusive esta. O evento sai por
      // lá, com o pendente resolvendo a origem para "studio". Emissão
      // local só como fallback quando não há listener (MMKV antigo).
      if (!t.subscription && t.pendingStudioWrites.delete(key)) {
        emitChange(t, key, "studio");
      }
    },

    async remove(instanceId, key) {
      const t = get(instanceId);
      t.pendingStudioWrites.set(key, Date.now() + ECHO_TTL_MS);
      t.instance.delete(key);
      if (!t.subscription && t.pendingStudioWrites.delete(key)) {
        emitChange(t, key, "studio");
      }
    },

    subscribe(instanceId, listener) {
      const t = get(instanceId);
      t.listeners.add(listener);
      return () => t.listeners.delete(listener);
    },
  };
}
