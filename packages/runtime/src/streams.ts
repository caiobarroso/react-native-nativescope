import { PROTOCOL_VERSION, STREAM_CHUNK_SIZE, type EventMessage } from "@rnsi/protocol";
import { breathe } from "./key-pagination.ts";

/**
 * Streaming chunked no lado do device (plano de grandes volumes §B).
 *
 * Um valor de 100 MB nunca vira uma mensagem WS de 100 MB: sai em chunks de
 * 64 KB com yield entre um e outro — a JS thread do app segue livre e o
 * Studio processa cada mensagem em tempo constante. Cancelável a qualquer
 * momento (o usuário fechou o viewer → paramos de ler e transmitir).
 *
 * O checksum é FNV-1a 32-bit: sinal de integridade barato o suficiente para
 * rodar no device sobre GB de dados. Não é criptográfico de propósito.
 */

export interface StreamHub {
  /** Inicia a transmissão de `data` e devolve o streamId imediatamente.
   * O primeiro chunk só sai num tick futuro — o command-result que anuncia
   * o streamId sempre chega ao Studio antes dos chunks. */
  streamText(data: string): string;
  /**
   * Transmite uma FONTE incremental (export de GB): os pedaços produzidos
   * são agregados em chunks de 64 KB e enviados conforme saem — nada é
   * materializado inteiro na memória do device. Cancelar para a fonte.
   */
  streamFrom(source: () => AsyncIterable<string>): string;
  cancel(streamId: string): void;
}

export function fnv1a32(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function createStreamHub(emit: (event: EventMessage) => void): StreamHub {
  let nextId = 1;
  const active = new Set<string>();
  const cancelled = new Set<string>();

  function chunkEvent(streamId: string, seq: number, data: string): EventMessage {
    return {
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      type: "stream.chunk",
      payload: { streamId, seq, data },
    };
  }

  function endEvent(
    payload: Extract<EventMessage, { type: "stream.end" }>["payload"],
  ): EventMessage {
    return {
      kind: "event",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      type: "stream.end",
      payload,
    };
  }

  function runStream(streamId: string, source: () => AsyncIterable<string>): void {
    active.add(streamId);
    void (async () => {
      let seq = 0;
      let hash = 0x811c9dc5;
      let buffer = "";
      const sendChunk = async (chunk: string): Promise<boolean> => {
        await breathe();
        if (cancelled.has(streamId)) return false;
        hash = fnv1a32(chunk, hash);
        emit(chunkEvent(streamId, seq++, chunk));
        return true;
      };
      try {
        for await (const piece of source()) {
          if (cancelled.has(streamId)) return;
          // Consumo por offset, nunca re-fatiando o restante a cada chunk —
          // um piece de 100 MB custa O(n), não O(n²).
          const combined = buffer.length > 0 ? buffer + piece : piece;
          let offset = 0;
          while (combined.length - offset >= STREAM_CHUNK_SIZE) {
            const chunk = combined.slice(offset, offset + STREAM_CHUNK_SIZE);
            offset += STREAM_CHUNK_SIZE;
            if (!(await sendChunk(chunk))) return;
          }
          buffer = offset > 0 ? combined.slice(offset) : combined;
        }
        if (buffer.length > 0 && !(await sendChunk(buffer))) return;
        await breathe();
        if (cancelled.has(streamId)) return;
        emit(endEvent({ streamId, ok: true, chunkCount: seq, checksum: hash.toString(16) }));
      } catch (cause) {
        emit(
          endEvent({
            streamId,
            ok: false,
            chunkCount: seq,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      } finally {
        active.delete(streamId);
        cancelled.delete(streamId);
      }
    })();
  }

  return {
    streamText(data) {
      const streamId = `stream-${nextId++}`;
      runStream(streamId, async function* () {
        yield data;
      });
      return streamId;
    },

    streamFrom(source) {
      const streamId = `stream-${nextId++}`;
      runStream(streamId, source);
      return streamId;
    },

    cancel(streamId) {
      if (active.has(streamId)) cancelled.add(streamId);
    },
  };
}
