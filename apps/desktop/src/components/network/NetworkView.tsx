import { NetworkList } from "./NetworkList.tsx";
import { NetworkDetail } from "./NetworkDetail.tsx";

/** Área principal do módulo de Network: lista (esquerda) + detalhe (direita). */
export function NetworkView() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 w-[46%] min-w-[360px] max-w-[720px] flex-col">
        <NetworkList />
      </div>
      <NetworkDetail />
    </div>
  );
}
