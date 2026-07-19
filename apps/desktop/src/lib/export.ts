/**
 * Sink de arquivo para exports streaming (plano de grandes volumes §D).
 *
 * Caminho preferido: File System Access API — cada chunk vai direto ao
 * disco, então 2 GB fluem device → arquivo sem nunca residir na memória da
 * aba. Fallback (Safari/Firefox): acumula partes e baixa como Blob — o
 * browser ainda lida bem com centenas de MB porque as partes não são
 * concatenadas em uma string única.
 */

export interface FileSink {
  write(chunk: string): void;
  close(): Promise<void>;
  abort(): Promise<void>;
  /** true quando o fallback em memória está em uso (sem streaming p/ disco). */
  buffered: boolean;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
  }) => Promise<{
    createWritable(): Promise<{
      write(data: string): Promise<void>;
      close(): Promise<void>;
      abort(): Promise<void>;
    }>;
  }>;
}

/** null quando o usuário cancelou o seletor de arquivo. */
export async function createFileSink(suggestedName: string): Promise<FileSink | null> {
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (picker) {
    let handle;
    try {
      handle = await picker.call(window, { suggestedName });
    } catch {
      return null; // usuário cancelou
    }
    const writable = await handle.createWritable();
    // write() é enfileirado numa cadeia: a ordem dos chunks é preservada e
    // erros aparecem no close().
    let chain: Promise<void> = Promise.resolve();
    return {
      buffered: false,
      write(chunk) {
        chain = chain.then(() => writable.write(chunk));
      },
      async close() {
        await chain;
        await writable.close();
      },
      async abort() {
        await writable.abort().catch(() => {});
      },
    };
  }

  const parts: string[] = [];
  return {
    buffered: true,
    write(chunk) {
      parts.push(chunk);
    },
    async close() {
      const blob = new Blob(parts, { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = suggestedName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
    async abort() {
      parts.length = 0;
    },
  };
}
