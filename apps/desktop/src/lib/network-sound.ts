import type { NetworkRequest } from "@rnsi/protocol";

export type NetworkSoundMode = "off" | "all" | "errors" | "endpoints";

export interface NetworkSoundSettings {
  mode: NetworkSoundMode;
  endpointRules: string[];
  volume: number;
}

export const DEFAULT_NETWORK_SOUND: NetworkSoundSettings = {
  mode: "off",
  endpointRules: [],
  volume: 0.7,
};

const STORAGE_KEY = "rnsi.network.sound";
let audioContext: AudioContext | null = null;
let lastToneAt = 0;

export function loadNetworkSoundSettings(): NetworkSoundSettings {
  if (typeof window === "undefined") return DEFAULT_NETWORK_SOUND;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NETWORK_SOUND;
    const parsed = JSON.parse(raw) as Partial<NetworkSoundSettings>;
    const mode =
      parsed.mode === "all" ||
      parsed.mode === "errors" ||
      parsed.mode === "endpoints" ||
      parsed.mode === "off"
        ? parsed.mode
        : "off";
    const endpointRules = Array.isArray(parsed.endpointRules)
      ? parsed.endpointRules
          .filter((rule): rule is string => typeof rule === "string")
          .slice(0, 30)
      : [];
    const volume =
      typeof parsed.volume === "number"
        ? clampVolume(parsed.volume)
        : DEFAULT_NETWORK_SOUND.volume;
    return { mode, endpointRules, volume };
  } catch {
    return DEFAULT_NETWORK_SOUND;
  }
}

export function saveNetworkSoundSettings(settings: NetworkSoundSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Preferences remain available for this session when storage is unavailable.
  }
}

export function normalizeEndpointRule(rule: string): string {
  return rule.trim().replace(/\s+/g, " ");
}

export function requestMatchesSoundRule(
  request: NetworkRequest,
  rule: string,
): boolean {
  const normalized = normalizeEndpointRule(rule).toLowerCase();
  if (!normalized) return false;

  const endpoint = `${request.method} ${request.path}`.toLowerCase();
  const candidate = normalized.includes(" ")
    ? endpoint
    : `${request.path} ${request.url}`.toLowerCase();

  if (!normalized.includes("*")) return candidate.includes(normalized);

  const escaped = normalized
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(escaped, "i").test(candidate);
}

export function shouldPlayNetworkSound(
  request: NetworkRequest,
  settings: NetworkSoundSettings,
): boolean {
  if (settings.mode === "off") return false;
  if (settings.mode === "all") return true;
  if (settings.mode === "errors")
    return request.status === null || request.status >= 400;
  return settings.endpointRules.some((rule) =>
    requestMatchesSoundRule(request, rule),
  );
}

export function playNetworkRequestSound(
  request: NetworkRequest,
  settings: NetworkSoundSettings,
): void {
  if (!shouldPlayNetworkSound(request, settings)) return;
  playTone(request.status === null || request.status >= 400, settings.volume);
}

export function previewNetworkSound(
  volume: number = DEFAULT_NETWORK_SOUND.volume,
): void {
  playTone(false, volume);
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_NETWORK_SOUND.volume;
  return Math.min(1, Math.max(0, volume));
}

function playTone(error: boolean, volume: number): void {
  if (typeof window === "undefined") return;
  try {
    const normalizedVolume = clampVolume(volume);
    if (normalizedVolume === 0) return;

    const requestedAt = Date.now();
    if (requestedAt - lastToneAt < 90) return;
    lastToneAt = requestedAt;

    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;

    audioContext ??= new AudioContextCtor();
    if (audioContext.state === "suspended") void audioContext.resume();

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(error ? 390 : 720, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      error ? 300 : 540,
      now + 0.16,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      normalizedVolume * (error ? 0.24 : 0.2),
      now + 0.018,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.19);
  } catch {
    // Audio is an optional affordance; browser policy must never affect capture.
  }
}
