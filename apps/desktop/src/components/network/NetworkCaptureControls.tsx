import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellRing,
  Flag,
  Pause,
  Play,
  Plus,
  TestTube2,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  normalizeEndpointRule,
  previewNetworkSound,
  type NetworkSoundMode,
} from "../../lib/network-sound.ts";
import { useNetwork } from "../../lib/network-store.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";

const SOUND_MODES: Array<{
  value: NetworkSoundMode;
  label: string;
  description: string;
}> = [
  { value: "off", label: "Off", description: "Keep capture silent." },
  {
    value: "all",
    label: "All requests",
    description: "Play a subtle sound for every new request.",
  },
  {
    value: "errors",
    label: "Errors only",
    description: "Notify only for network errors and 4xx/5xx responses.",
  },
  {
    value: "endpoints",
    label: "Selected endpoints",
    description: "Notify only when a request matches one of your rules.",
  },
];

export function NetworkCaptureControls() {
  const requests = useNetwork((state) => state.requests);
  const paused = useNetwork((state) => state.capturePaused);
  const sound = useNetwork((state) => state.sound);
  const startNewCapture = useNetwork((state) => state.startNewCapture);
  const setCapturePaused = useNetwork((state) => state.setCapturePaused);
  const clearRequests = useNetwork((state) => state.clearRequests);
  const setSound = useNetwork((state) => state.setSound);
  const [soundOpen, setSoundOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [ruleDraft, setRuleDraft] = useState("");
  const soundMenuRef = useRef<HTMLDivElement>(null);

  const endpointSuggestions = useMemo(
    () =>
      Array.from(
        new Set(requests.map((request) => `${request.method} ${request.path}`)),
      ).slice(0, 80),
    [requests],
  );

  useEffect(() => {
    if (!soundOpen) return;
    function closeOnOutsideClick(event: MouseEvent): void {
      if (!soundMenuRef.current?.contains(event.target as Node))
        setSoundOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setSoundOpen(false);
    }
    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [soundOpen]);

  function chooseSoundMode(mode: NetworkSoundMode): void {
    setSound({ ...sound, mode });
    if (mode !== "off") previewNetworkSound(sound.volume);
  }

  function addRule(): void {
    const rule = normalizeEndpointRule(ruleDraft);
    if (!rule || sound.endpointRules.includes(rule)) return;
    setSound({
      mode: "endpoints",
      endpointRules: [...sound.endpointRules, rule],
      volume: sound.volume,
    });
    setRuleDraft("");
  }

  function removeRule(rule: string): void {
    setSound({
      ...sound,
      endpointRules: sound.endpointRules.filter((item) => item !== rule),
    });
  }

  return (
    <>
      <div className="ml-auto flex h-7 items-center gap-1.5 border-l border-border pl-2">
        <button
          type="button"
          onClick={startNewCapture}
          disabled={requests.length === 0}
          title="Start a focused capture without deleting earlier requests"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Flag size={12} strokeWidth={1.5} />
          New capture
        </button>

        <button
          type="button"
          onClick={() => setCapturePaused(!paused)}
          title={
            paused
              ? "Resume capturing new requests"
              : "Pause capturing new requests"
          }
          className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] ${
            paused
              ? "border-accent bg-accent-wash text-accent"
              : "border-border bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text"
          }`}
        >
          {paused ? (
            <Play size={12} strokeWidth={1.5} />
          ) : (
            <Pause size={12} strokeWidth={1.5} />
          )}
          {paused ? "Resume" : "Pause"}
        </button>

        <div ref={soundMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setSoundOpen((open) => !open)}
            aria-expanded={soundOpen}
            title="Configure sounds for new requests"
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] ${
              sound.mode !== "off"
                ? "border-accent bg-accent-wash text-accent"
                : "border-border bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text"
            }`}
          >
            {sound.mode === "off" ? (
              <Bell size={12} strokeWidth={1.5} />
            ) : (
              <BellRing size={12} strokeWidth={1.5} />
            )}
            Sound
          </button>

          {soundOpen && (
            <div className="absolute right-0 top-9 z-50 w-[340px] rounded-md border border-border-strong bg-surface-raised shadow-xl shadow-black/15">
              <header className="flex h-10 items-center justify-between border-b border-border px-3">
                <div>
                  <p className="text-[12px] font-semibold text-text">
                    Request sounds
                  </p>
                  <p className="text-[10px] text-text-subtle">
                    Local preference for this Studio.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => previewNetworkSound(sound.volume)}
                  title="Play a test sound"
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  <TestTube2 size={11} strokeWidth={1.5} />
                  Test
                </button>
              </header>

              <div className="space-y-1 p-2">
                {SOUND_MODES.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    onClick={() => chooseSoundMode(option.value)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left ${
                      sound.mode === option.value
                        ? "bg-accent-wash"
                        : "hover:bg-surface-hover"
                    }`}
                  >
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border ${
                        sound.mode === option.value
                          ? "border-accent bg-accent"
                          : "border-border-strong"
                      }`}
                    />
                    <span className="min-w-0">
                      <strong className="block text-[11px] font-medium text-text">
                        {option.label}
                      </strong>
                      <span className="block text-[10px] leading-4 text-text-subtle">
                        {option.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex h-10 items-center gap-2 border-t border-border px-3">
                <Volume2
                  size={12}
                  strokeWidth={1.5}
                  className="shrink-0 text-text-subtle"
                />
                <label
                  htmlFor="network-sound-volume"
                  className="text-[10px] font-medium text-text-muted"
                >
                  Volume
                </label>
                <input
                  id="network-sound-volume"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(sound.volume * 100)}
                  onChange={(event) =>
                    setSound({
                      ...sound,
                      volume: Number(event.target.value) / 100,
                    })
                  }
                  onPointerUp={(event) =>
                    previewNetworkSound(
                      Number((event.currentTarget as HTMLInputElement).value) /
                        100,
                    )
                  }
                  onKeyUp={(event) => {
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight" ||
                      event.key === "Home" ||
                      event.key === "End"
                    ) {
                      previewNetworkSound(
                        Number(event.currentTarget.value) / 100,
                      );
                    }
                  }}
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-accent"
                  aria-label="Request sound volume"
                />
                <span className="w-8 text-right font-mono text-[10px] tabular-nums text-text-subtle">
                  {Math.round(sound.volume * 100)}%
                </span>
              </div>

              {sound.mode === "endpoints" && (
                <div className="border-t border-border p-3">
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                    Endpoint rules
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      value={ruleDraft}
                      onChange={(event) => setRuleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addRule();
                        }
                      }}
                      list="network-endpoint-suggestions"
                      placeholder="POST /auth/*"
                      className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 font-mono text-[11px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                    />
                    <datalist id="network-endpoint-suggestions">
                      {endpointSuggestions.map((endpoint) => (
                        <option key={endpoint} value={endpoint} />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      onClick={addRule}
                      disabled={!normalizeEndpointRule(ruleDraft)}
                      title="Add endpoint rule"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
                    >
                      <Plus size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-text-subtle">
                    Pick a captured endpoint or type any path. Use{" "}
                    <code>*</code> as a wildcard.
                  </p>
                  {sound.endpointRules.length > 0 && (
                    <ul className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                      {sound.endpointRules.map((rule) => (
                        <li
                          key={rule}
                          className="inline-flex h-6 max-w-full items-center gap-1 rounded border border-border bg-surface px-1.5 font-mono text-[10px] text-text-muted"
                        >
                          <span className="truncate">{rule}</span>
                          <button
                            type="button"
                            onClick={() => removeRule(rule)}
                            title={`Remove ${rule}`}
                            className="shrink-0 text-text-subtle hover:text-deleted"
                          >
                            <X size={10} strokeWidth={1.5} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          disabled={requests.length === 0}
          title="Clear all captured requests"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-deleted disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Trash2 size={12} strokeWidth={1.5} />
        </button>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="Clear captured requests?"
          description="This removes the Network history from the Studio. It does not affect your app or send any request."
          detail={
            <p className="rounded-md bg-surface-sunken px-2.5 py-2 font-mono text-[11px] text-text-muted">
              {requests.length} captured{" "}
              {requests.length === 1 ? "request" : "requests"}
            </p>
          }
          confirmLabel="Clear requests"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            clearRequests();
            setConfirmClear(false);
          }}
        />
      )}
    </>
  );
}
