import { Check, Loader2 } from "lucide-react";
import { useStudio } from "../lib/store.ts";

/**
 * A tela mais importante do produto (plano §5.2): é a primeira que todo
 * usuário vê, e num produto plug-n-play é onde a promessa se cumpre ou
 * quebra. Diagnóstica, nunca um spinner mudo.
 */
export function WaitingScreen() {
  const phase = useStudio((s) => s.phase);

  if (phase === "no-token") {
    return (
      <Center>
        <h1 className="mb-2 text-[15px] font-semibold">Abra pelo comando</h1>
        <p className="max-w-sm text-text-muted">
          O Studio precisa do token de sessão gerado pela CLI. Rode no seu
          projeto React Native:
        </p>
        <pre className="mt-4 rounded-lg border border-border bg-surface-raised px-4 py-3 font-mono text-[12px]">
          pnpm rn-storage-inspector
        </pre>
      </Center>
    );
  }

  return (
    <Center>
      <Loader2 size={20} strokeWidth={1.5} className="mb-4 animate-spin text-accent" />
      <h1 className="mb-4 text-[15px] font-semibold">
        {phase === "connecting" ? "Conectando ao serviço local…" : "Aguardando o app conectar…"}
      </h1>

      {phase === "waiting-app" && (
        <ul className="space-y-2 text-left text-text-muted">
          <Item ok>Serviço local de pé</Item>
          <Item ok>Token de sessão validado</Item>
          <li className="pt-2 text-text-subtle">
            Abra ou recarregue o app no simulador.
            <br />
            Android físico: a CLI já rodou <code className="font-mono">adb reverse</code>.
          </li>
        </ul>
      )}
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      {children}
    </div>
  );
}

function Item({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {ok && <Check size={14} strokeWidth={2} className="text-created" />}
      {children}
    </li>
  );
}
