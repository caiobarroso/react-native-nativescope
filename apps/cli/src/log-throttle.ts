/**
 * Log agregado por janela.
 *
 * O terminal é o único lugar onde o usuário confere se a ferramenta está
 * saudável: repetição constante ensina a ignorar a saída, e aí o `app
 * connected` e os erros de verdade se perdem no meio. O watcher de adb já
 * segue essa regra (android.ts: só loga quando o estado muda); os caminhos de
 * rejeição do handshake não seguiam, e um único cliente inválido conseguia
 * encher a tela sozinho.
 *
 * Regra: a primeira ocorrência de cada `key` sai na hora, com detalhe; as
 * repetições dentro da janela viram um contador que sai em UMA linha no fim.
 * Teto garantido: uma linha por key por janela, independente do volume.
 */
export interface ThrottledLogger {
  log(key: string, line: string): void;
  /** Cancela os timers pendentes — chamado no shutdown do serviço. */
  stop(): void;
}

export const DEFAULT_LOG_WINDOW_MS = 60_000;

export function createThrottledLogger(
  emit: (line: string) => void,
  windowMs: number = DEFAULT_LOG_WINDOW_MS,
): ThrottledLogger {
  interface Window {
    /** repetições engolidas desde a linha que já saiu */
    count: number;
    /** última linha vista: é ela que o resumo repete */
    line: string;
    timer: ReturnType<typeof setTimeout>;
  }

  const windows = new Map<string, Window>();

  function openWindow(key: string, line: string): void {
    const timer = setTimeout(() => closeWindow(key), windowMs);
    // Nunca segurar o processo vivo por causa de um timer de log.
    timer.unref?.();
    windows.set(key, { count: 0, line, timer });
  }

  function closeWindow(key: string): void {
    const window = windows.get(key);
    if (!window) return;
    windows.delete(key);
    if (window.count === 0) return; // silêncio: o assunto morreu
    const seconds = Math.round(windowMs / 1000);
    emit(`${window.line} (+${window.count} more in the last ${seconds}s)`);
    // Ainda há tráfego: reabre para que o próximo resumo respeite a janela.
    openWindow(key, window.line);
  }

  return {
    log(key, line) {
      const window = windows.get(key);
      if (window) {
        window.count += 1;
        window.line = line;
        return;
      }
      emit(line);
      openWindow(key, line);
    },
    stop() {
      for (const window of windows.values()) clearTimeout(window.timer);
      windows.clear();
    },
  };
}
