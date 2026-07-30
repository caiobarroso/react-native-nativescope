import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";

interface ConfirmDialogProps {
  title: string;
  description: string;
  detail?: ReactNode;
  loading?: boolean;
  /** Confirmação forte: o botão só libera quando o chamador diz que pode. */
  confirmDisabled?: boolean;
  confirmLabel?: string;
  loadingLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  detail,
  loading = false,
  confirmDisabled = false,
  confirmLabel = "Delete",
  loadingLabel = "Deleting...",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/25 px-4 pt-24"
      onMouseDown={(event) => {
        if (!loading && event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-md border border-border-strong bg-surface-raised shadow-2xl shadow-black/20">
        <div className="flex h-11 items-center gap-2 border-b border-border px-4">
          <Trash2 size={15} strokeWidth={1.5} className="text-deleted" />
          <h2 id="confirm-dialog-title" className="text-[13px] font-semibold">
            {title}
          </h2>
        </div>
        <div className="space-y-2 p-4">
          <p className="text-[12px] leading-5 text-text-muted">{description}</p>
          {detail}
        </div>
        <div className="flex h-12 items-center justify-end gap-2 border-t border-border px-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="h-8 rounded-md px-3 text-[12px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className="h-8 rounded-md bg-deleted px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
