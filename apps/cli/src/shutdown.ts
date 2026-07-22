/**
 * Encerramento ordenado da CLI.
 *
 * Sem isto, a CLI não tratava sinal nenhum e não observava o Metro filho: ao
 * parar o dev server, o processo pai continuava vivo segurando o terminal,
 * o serviço WebSocket e o watcher de adb — o usuário via "Stopped server" e
 * mesmo assim o prompt não voltava e o log continuava saindo.
 *
 * Duas garantias: roda uma vez só (sinal repetido não reentra) e roda TODOS os
 * passos mesmo que um falhe — um adb travado não pode impedir o serviço de
 * fechar nem o processo de sair.
 */
export interface ShutdownStep {
  name: string;
  run: () => void;
}

export function createShutdown(options: {
  steps: ShutdownStep[];
  exit: (code: number) => void;
  onStepError?: (name: string, error: unknown) => void;
}): (code?: number) => void {
  let done = false;
  return (code = 0) => {
    if (done) return;
    done = true;
    for (const step of options.steps) {
      try {
        step.run();
      } catch (error) {
        options.onStepError?.(step.name, error);
      }
    }
    options.exit(code);
  };
}
