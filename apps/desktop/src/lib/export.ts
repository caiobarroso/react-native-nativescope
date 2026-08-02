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
  /**
   * Preenchido no PRIMEIRO write que falhar — disco cheio, permissão revogada,
   * handle invalidado. Quem transfere precisa checar e parar: os writes são
   * enfileirados numa cadeia, então sem isto a falha só aparecia no close(),
   * depois de o arquivo inteiro ter trafegado do device à toa. Num export de
   * GB isso é a diferença entre falhar no primeiro chunk e falhar meia hora
   * depois, no último.
   */
  readonly failure: Error | null;
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
    // write() é enfileirado numa cadeia: a ordem dos chunks é preservada. O
    // erro é capturado na hora em `failure` (e re-lançado no close) em vez de
    // ficar latente na cadeia — ver o doc de FileSink.failure.
    let chain: Promise<void> = Promise.resolve();
    let failure: Error | null = null;
    return {
      buffered: false,
      get failure() {
        return failure;
      },
      write(chunk) {
        if (failure) return; // já morreu: não enfileira mais nada
        chain = chain
          .then(() => writable.write(chunk))
          .catch((cause: unknown) => {
            failure ??= cause instanceof Error ? cause : new Error(String(cause));
          });
      },
      async close() {
        await chain;
        if (failure) throw failure;
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
    // O fallback só empurra num array: não há disco para falhar.
    failure: null,
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
