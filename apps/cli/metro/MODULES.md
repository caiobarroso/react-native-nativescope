# NativeScope — sistema de módulos (contrato de encaixe)

NativeScope é modular e **opt-in**. Storage e **network** são módulos; ambos
plugam no mesmo terreno sem tocar um no outro, no transporte nem no resolver.

Este doc é o contrato para adicionar um módulo novo. O módulo de **network** é a
**implementação de referência** — cada passo abaixo aponta para o código real:

- Runtime: [`packages/runtime/src/modules/network`](../../../packages/runtime/src/modules/network) (patch de XHR, buffer, replay).
- Desktop: [`apps/desktop/src/components/network`](../../desktop/src/components/network) (lista, detalhe, diff, storage-impact).
- Payload: [`packages/protocol/src/network.ts`](../../../packages/protocol/src/network.ts).

## Como o terreno funciona

- **Uma conexão por device, compartilhada.** O transporte (WebSocket, reconnect,
  handshake) é agnóstico de módulo. Módulos **não** abrem conexão própria — eles
  multiplexam eventos/comandos sobre a mesma conexão.
- **Config é a fonte da verdade** (`nativescope.config.*`). Módulo só roda se
  declarado em `modules.<key>`. Sem config, o default legado liga só storage
  (retrocompat). Regra única em [`modules.cjs`](./modules.cjs) → `computeEnabledModules`.
- **Boot independente de storage.** `babel-transformer.cjs` injeta
  `require("__rnsi_boot__")` no `InitializeCore` do RN (sempre no grafo, roda
  antes do app). `shims/_boot.js` chama `bootModules()`, que sobe o runtime e
  instala os módulos `earlyBoot` ligados. **Em release o transformer não injeta
  nada** — a instrumentação não existe no grafo de produção, em vez de existir
  como stub vazio. O resolver ainda devolve `{ type: "empty" }` para
  `__rnsi_boot__` em produção, como cinto para o caso de outro transformer
  injetar o require. Motivo de não usar arquivo: um stub do pacote mora FORA da
  árvore do projeto (entra por symlink) e o Metro precisa hasheá-lo, o que
  derrubava `expo export` com "Failed to get the SHA-1".
- **Vocabulário L3 genérico.** O protocolo tem `module.event` (runtime→Studio) e
  `module.command` (Studio→runtime). O runtime expõe `sendModuleEvent` e
  `onModuleCommand`. O servidor relaya/roteia isso pelos caminhos genéricos que
  já existem — sem código novo.

## Contrato: o que tocar para plugar um módulo

Exemplo com `network`. Tudo aditivo.

### 1. Manifesto — [`modules.cjs`](./modules.cjs)

Adicione uma entrada em `MODULES`:

```js
{
  key: "network",
  label: "Network inspector",
  description: "fetch / XHR / WebSocket",
  earlyBoot: true,          // precisa subir ANTES do app p/ instrumentar fetch
  available: true,          // aparece no `nativescope init` e no gating
  configTemplate: "network: true,",
}
```

Só isso já faz o módulo aparecer no menu do `nativescope init`, na mensageria do
terminal e no gating opt-in.

### 2. Installer — [`shims/_bootstrap.js`](./shims/_bootstrap.js) → `MODULE_INSTALLERS`

```js
const MODULE_INSTALLERS = {
  network(runtime, config) {
    // patch de fetch/XHR/WebSocket; emita fatos via:
    //   runtime.sendModuleEvent("network", "request", { ... })
    // e trate comandos do Studio via:
    //   runtime.onModuleCommand("network", (command, data) => { ... })
    patchNetwork(runtime, config);
  },
};
```

`bootModules()` chama o installer só se o módulo estiver `earlyBoot` **e** ligado
no config. O `runtime` já vem conectado (mesma conexão do storage).

### 3. Tipos — [`../app/index.d.ts`](../app/index.d.ts)

Preencha `NativeScopeNetworkModuleConfig` com as opções reais do módulo (hoje é um
slot inerte que aceita `network: true`).

### 4. Runtime/protocol (se precisar de payload tipado)

O envelope `module.event`/`module.command` carrega `data: unknown` — o módulo é
dono do contrato do seu payload. Se quiser validação forte, adicione um schema do
lado do módulo. **Não** edite as uniões de storage (`key-value.*`, `database.*`).

### 5. Desktop (UI)

Assine `module.event` filtrando por `payload.module === "network"`. O envelope já
garante que o evento chega ao Studio, carimbado com o `deviceId` de origem.

## O que NÃO tocar

- Schema de storage (`key-value.*`, `database.*`) em `@rnsi/protocol`.
- Transporte / handshake (`packages/runtime/src/transport.ts`).
- Resolver / seam de injeção (`withNativeScope.cjs`, `babel-transformer.cjs`).
- Os shims de storage.

Se você precisou mexer em algum destes para plugar um módulo, provavelmente há um
caminho aditivo melhor — reveja o contrato acima.

Isto vale para **módulos**. Um **provider de storage novo** (outro banco, outro
key/value) é outra coisa: aí mexer no resolver e adicionar um shim é o caminho
certo, não o desvio. O checklist está nas docs, em
`content/docs/storage/adding-a-provider.mdx`.
