# NativeScope — sistema de módulos (contrato de encaixe)

NativeScope é modular e **opt-in**. Storage, **network** e **logs** são módulos;
todos plugam no mesmo terreno sem tocar um no outro, no transporte nem no resolver.

O **Timeline** do Studio não é um quarto módulo nem uma linha de config: é uma lente desktop que
mescla os eventos que Logs, Network e Storage já capturaram, sempre ancorada em um momento.

Este doc é o contrato para adicionar um módulo novo. O módulo de **network** é a
**implementação de referência** — cada passo abaixo aponta para o código real:

- Runtime: [`packages/runtime/src/modules/network`](../../../packages/runtime/src/modules/network) (patch de XHR, buffer, replay).
- Desktop: [`apps/desktop/src/components/network`](../../desktop/src/components/network) (lista, detalhe, diff, storage-impact).
- Payload: [`packages/protocol/src/network.ts`](../../../packages/protocol/src/network.ts).

O módulo de **logs** é a segunda referência, e cobre dois problemas que o network
não tem — vale olhar quando o seu módulo se parecer com ele:

- **Volume.** Request é evento raro; log é rajada. A unidade de fio é o **lote**
  (`createLogBatcher` em [`modules/logs/capture.ts`](../../../packages/runtime/src/modules/logs/capture.ts)),
  com fusão de idênticas, teto por segundo e contagem honesta de descarte.
- **Fatos vs. estado.** `sendEvent` descarta tudo antes do `hello-ack`, e todo
  reconnect reabre essa janela. Storage sobrevive porque o hello-ack reanuncia os
  providers; um módulo que emite fatos precisa bufferizar. É para isso que existe
  `runtime.onReadyChange` — use-o em vez de perder o startup do app.

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

O envelope já garante que o evento chega ao Studio carimbado com o `deviceId` de
origem — mas o desktop é onde mais arquivo se toca, e nenhum deles quebra o build
se você esquecer (todos os consumidores de `activeModule` são ternários, não
`switch` exaustivo). O checklist real, na ordem:

1. **Roteamento** — `lib/studio-client.ts`, `case "module.event"`: adicione um
   branch filtrando `payload.module` e mande o `data` cru ao store do módulo.
   Some também um `use<Mod>.getState().reset()` ao lado dos resets de
   `useNetwork` (há dois: troca de device e contexto JS novo do app).
2. **Store do módulo** — `lib/<mod>-store.ts` (zustand, separado do `useStudio`).
   Valide com zod **na borda do store** (`safeParse`, descarta o inválido),
   mantenha um anel limitado e resete no device switch. Molde: `network-store.ts`.
3. **Derivação pura** — `lib/<mod>-select.ts`: filtro, agrupamento e o que mais
   tiver regra. Fora do store porque é a parte testável sem React.
4. **Superfície ativa** — `lib/store.ts`: adicione a chave em `ActiveModule` e
   **audite à mão** os consumidores (`App.tsx`, `Header.tsx`, `Sidebar.tsx`); sem
   isso o módulo novo cai silenciosamente nos painéis de storage.
5. **UI** — `components/<mod>/`, com uma `<Mod>View` no topo. Se a lista tiver
   painel redimensionável, registre o painel em `lib/layout.ts` (`PanelId` +
   `PANELS`).
6. **Registro visual** — `components/Sidebar.tsx`: uma `ModuleSection` nova.
   A chrome do módulo (pause, clear, marcadores) vive **dentro da view**, na barra
   de filtros — o `Header` é só do storage. Ver `NetworkCaptureControls`.

Nada disso precisa de código no servidor: o relay de `module.event` é genérico.

⚠️ **`.gitignore`**: a raiz ignora `logs/`, `dist/`, `out/`, `coverage/` — e esses
padrões casam em **qualquer profundidade**. Um módulo cujo nome bata com um desses
precisa de uma negação explícita (`!caminho/do/modulo/`), senão o código compila
local e nunca chega ao repositório. Já aconteceu com o módulo de Logs.

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
