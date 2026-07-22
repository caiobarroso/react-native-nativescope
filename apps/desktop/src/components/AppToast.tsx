import { useState } from "react";
import { X } from "lucide-react";

export interface AppToastState {
  message: string;
  undo?: () => Promise<void>;
}

export function AppToast({ toast, onClose }: { toast: AppToastState; onClose: () => void }) {
  const [undoing, setUndoing] = useState(false);

  return (
    <div className="rnsi-snackbar pointer-events-auto absolute bottom-3 right-3 z-20 flex min-h-11 w-[min(360px,calc(100%-24px))] items-center gap-2 rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-[12px] text-text shadow-md shadow-black/5">
      <span className="min-w-0 flex-1 truncate font-medium">{toast.message}</span>
      {toast.undo && (
        <button
          onClick={() => {
            setUndoing(true);
            void toast.undo?.().finally(() => {
              setUndoing(false);
              onClose();
            });
          }}
          disabled={undoing}
          className="shrink-0 font-medium text-accent underline decoration-accent/45 underline-offset-3 hover:text-accent-hover disabled:opacity-50"
        >
          {undoing ? "undoing..." : "undo"}
        </button>
      )}
      <button
        onClick={onClose}
        title="Close"
        className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}
