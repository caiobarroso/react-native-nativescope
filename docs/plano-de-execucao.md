# Plano de Execução — React Native Storage Inspector

Companheiro de `rn_studio_mvp_document.md`. Aquele documento define **o que** e **por quê**.
Este define **as decisões travadas**, **o design** e **a ordem de execução**.

---

# 1. Decisões travadas

Consolidadas a partir do debate de arquitetura e posicionamento. Estão aqui para serem
contestadas explicitamente, não para serem assumidas em silêncio.

| # | Decisão | Consequência |
|---|---|---|
| D1 | **OSS para a comunidade.** Sem monetização, sem cloud, sem telemetria. | Não há moat a defender. Otimizar para adoção e utilidade, não para retenção. |
| D2 | **Stack própria**, não plugin de framework existente. | Pagamos transporte, conectividade e distribuição. Ganhamos o direito de sequestrar o Metro (ver D3). |
| D3 | **Descoberta via interceptação no Metro** (`resolver.resolveRequest`), não registro manual. | Resolve auto-discovery, ordem de import, `enableChangeListener` e injeção do runtime de uma vez só. É a decisão central do projeto. |
| D4 | **Web-first. `src-tauri/` fica parado.** | Zero code signing, zero notarização, zero distribuição de binário no MVP. Tauri volta por gatilho (ver §7). |
| D5 | **UI é cliente web puro.** Zero imports de `@tauri-apps/api`. | Regra verificável em lint/CI. É o que mantém D4 reversível a custo zero. |
| D6 | **IA timeline-first**, não provider-first. | O timeline é estrutura persistente, não uma tela. Navegação por provider é secundária. |
| D7 | **MVP roda em Android Emulator + iOS Simulator.** | Android físico entra junto (mesmo `adb reverse`). iPhone físico fica para a Fase 5. |
| D8 | **CodeMirror 6, não Monaco.** | ~5MB vs. fração disso. Coerente com a premissa de leveza. |
| D9 | **`packages/core` não nasce agora.** | Violaria a regra §16.8 do doc original. Nasce quando houver segundo consumidor real. |

## Não-objetivos do MVP

Reafirmando, porque a maior ameaça ao projeto é mudar de ideia sobre isto no mês 4:

Network, logs, Redux/Zustand, performance, navegação, filesystem, state managers em geral.
O Rozenite tem 13 plugins e vai continuar tendo. **Não competimos em amplitude.**

---

# 2. Princípios de produto

Três objetivos, tratados como restrições de design — não como aspirações.

### P1 — Configuração extremamente fácil

> **Teste do README:** se o README precisar de mais de um bloco de código, falhamos.

```bash
pnpm add -D react-native-storage-inspector
pnpm rn-storage-inspector
```

Zero linhas no `index.js`. Zero mudança no `metro.config.js`. Zero registro de instância.
A CLI sobe o Metro com o config já mesclado, sobe o WS, serve a UI e abre o browser.

Escape hatch para setups customizados: `withStorageInspector(config)` manual. Documentado
como exceção, nunca como caminho principal.

### P2 — Design extremamente leve e simples

Paleta quente e papel, não o azul-cinza frio de todo dev tool. Densidade alta nos dados,
respiro generoso na moldura. Sem sombras pesadas, sem gradientes, sem bordas grossas.
Ver §4.

### P3 — Usabilidade auto-explicativa

Um dev de primeira semana abre e entende sem tutorial. Sem wizard, sem onboarding,
sem tooltip explicando conceito nosso. Se uma tela precisa de legenda, a tela está errada.

Corolário: **nenhum termo arquitetural nosso aparece na UI.** Não existe "adapter",
"capability", "provider", "runtime" ou "realtime" na interface. Existe "MMKV",
"AsyncStorage", "Atividade", "Chaves", "Tabelas".

### P4 — Profissional, com traço de startup, sem exagero

Sem ilustração, sem mascote, sem animação decorativa. O único movimento na tela é
o que comunica dado mudando. Acabamento de produto pago, entregue de graça.

---

# 3. Arquitetura

## 3.1 O shim — decisão central

```
app faz: import { MMKV } from 'react-native-mmkv'
              ↓
resolver.resolveRequest intercepta
              ↓
entrega nosso shim no lugar do módulo real
              ↓
shim embrulha a classe, registra toda instância, re-exporta o resto transparente
```

Três shims no MVP:

| Módulo | O que o shim faz |
|---|---|
| `react-native-mmkv` | Embrulha o construtor. Toda `new MMKV()` se auto-registra, inclusive encriptadas (a instância carrega a chave). |
| `@react-native-async-storage/async-storage` | Embrulha os métodos de escrita do singleton (`setItem`, `multiSet`, `mergeItem`, `removeItem`, `multiRemove`, `clear`). |
| `expo-sqlite` | Embrulha `openDatabaseAsync`/`openDatabaseSync`, **força `enableChangeListener: true`** e registra o banco. |

O runtime SDK entra no bundle por consequência: o shim importa ele. Se o app não usa
nenhuma das três libs, não há o que inspecionar.

**Gotchas conhecidos, a resolver na Fase 0:**

- O shim importando o módulo original re-entra no resolver e faz loop. Resolver checando
  `context.originModulePath` contra o diretório de shims.
- `resolveRequest` do usuário precisa ser **composto**, não substituído.
- **Release build tem que ser no-op absoluto.** Não é "gated com `__DEV__` e reza" — é
  teste automatizado que falha o CI se qualquer símbolo do inspector aparecer num bundle
  de produção. Vazar um interceptor de storage para produção alheia é o pior bug possível
  deste projeto.
- Wrapper fino. O argumento de venda do MMKV é velocidade; emitir evento sim, serializar
  de forma ansiosa não.

## 3.2 Transporte

| Alvo | Mecanismo | Status MVP |
|---|---|---|
| Android Emulator | `adb reverse tcp:4782 tcp:4782`, automatizado pela CLI | ✅ |
| Android físico (USB) | Mesmo `adb reverse` | ✅ |
| iOS Simulator | Compartilha loopback com o host | ✅ |
| iPhone físico | IP de LAN via `NativeModules.SourceCode.scriptURL`, + permissão de Local Network do iOS 14+, + `NSLocalNetworkUsageDescription` via config plugin, + novo dev build | Fase 5 |

## 3.3 Segurança local

"100% local" não significa "seguro". Um WS em loopback sem autenticação é alcançável por
qualquer processo da máquina e por qualquer página aberta no navegador — conexões WebSocket
de browser não passam por preflight de CORS. Sem validação, um site lê e escreve o
`auth.token` do app.

Mínimo obrigatório, na Fase 0, não depois:

- Bind exclusivo em `127.0.0.1`
- Token de sessão gerado pela CLI, exigido no handshake
- Validação de `Origin` no upgrade do WebSocket
- Blacklist de chaves sensíveis, configurável

## 3.4 Protocolo

Base em `rn_studio_mvp_document.md` §14 (Command/Event, Zod, `protocolVersion`), com
quatro adições:

- **Supressão de eco.** O listener do MMKV entrega só a chave, não quem escreveu. Set de
  escritas pendentes por `(providerId, instanceId, key)` com TTL curto para carimbar
  `source: 'studio'`.
- **Negociação de capabilities no handshake.** O runtime vive no `package.json` do usuário
  e o Studio atualiza sozinho — skew de versão é certeza, não risco.
- **Coalescing e teto de taxa.** Um loop de sync escrevendo 1000 chaves não pode derreter
  a UI. Colapsar em "N mudanças" acima do limiar.
- **Payload grande.** Truncar valor com "carregar completo" explícito; paginação
  server-side; `LIMIT` default no SQL.

## 3.5 Monorepo

```text
apps/
├── desktop/          # UI. Cliente web puro (D5). Serve estático via CLI.
│   ├── src/
│   └── src-tauri/    # parado, dormindo, intocado (D4)
├── cli/              # Metro wrapper + WS + serve + adb + discovery
└── playground/       # Expo app com as 3 libs
packages/
├── protocol/         # Zod schemas, commands, events, versão, erros
├── runtime/          # bootstrap, transport, registry, shims, adapters
└── testkit/          # contract tests + fakes + fixtures
```

`packages/core` não nasce agora (D9).

**Atenção:** Metro + symlinks do pnpm em `apps/playground` é dor conhecida. Reservar tempo
real na Fase 0. Plano B: `node-linker=hoisted` no `.npmrc`, ou playground fora do workspace
temporariamente.

---

# 4. Design system

## 4.1 Direção

Paleta quente, papel, humanista — inspirada na identidade Claude. A escolha é
deliberadamente contrária ao azul-cinza frio de VS Code, Chrome DevTools e afins. Um dev
tool quente é incomum o bastante para ser lembrado, e "leve" é mais fácil de atingir com
off-whites quentes do que com cinzas frios.

Coral (`#D97757`) é **acento, não cor de marca aplicada em tudo**. Aparece em: estado
ativo, foco, mudança recente, ação primária. Em nenhum outro lugar. Se a tela tem mais de
três pontos de coral, está errada.

## 4.2 Tokens

Tailwind v4 (`@theme` em CSS, não `tailwind.config.js`).

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  /* superfícies */
  --surface:          #FAF9F5;  /* fundo da app, papel quente */
  --surface-sunken:   #F0EEE6;  /* sidebar, painéis recuados */
  --surface-raised:   #FFFFFF;  /* cards, editor, modal */
  --surface-hover:    #F0EEE6;

  /* traço */
  --border:           #E5E2D9;
  --border-strong:    #D6D2C6;

  /* texto */
  --text:             #1F1E1D;  /* quase-preto quente, nunca #000 */
  --text-muted:       #6B6862;
  --text-subtle:      #9A968C;

  /* acento */
  --accent:           #D97757;
  --accent-hover:     #C4623F;
  --accent-wash:      #F5E6DF;  /* fundo de destaque, highlight de linha */

  /* semântica de dados */
  --created:          #5C8A5C;
  --updated:          #D97757;
  --deleted:          #C4544F;
  --created-wash:     #E8F0E8;
  --deleted-wash:     #F7E4E3;
}

.dark {
  --surface:          #1F1E1D;
  --surface-sunken:   #191817;
  --surface-raised:   #262624;
  --surface-hover:    #30302E;

  --border:           #3E3D3A;
  --border-strong:    #4E4C48;

  --text:             #F5F4EF;
  --text-muted:       #A8A49B;
  --text-subtle:      #6B6862;

  --accent:           #E08A6B;  /* clareado para contraste em fundo escuro */
  --accent-hover:     #EDA184;
  --accent-wash:      #3A2A24;

  --created:          #7FA87F;
  --updated:          #E08A6B;
  --deleted:          #D97570;
  --created-wash:     #24301F;
  --deleted-wash:     #3A2422;
}

@theme inline {
  --color-surface:        var(--surface);
  --color-surface-sunken: var(--surface-sunken);
  --color-surface-raised: var(--surface-raised);
  --color-surface-hover:  var(--surface-hover);
  --color-border:         var(--border);
  --color-border-strong:  var(--border-strong);
  --color-text:           var(--text);
  --color-text-muted:     var(--text-muted);
  --color-text-subtle:    var(--text-subtle);
  --color-accent:         var(--accent);
  --color-accent-hover:   var(--accent-hover);
  --color-accent-wash:    var(--accent-wash);
  --color-created:        var(--created);
  --color-updated:        var(--updated);
  --color-deleted:        var(--deleted);

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
}
```

**Modo:** três estados — claro, escuro, sistema. Default é sistema. Toggle no rodapé da
sidebar, não escondido em Settings. Persistido em `localStorage`.

## 4.3 Regras de aplicação

| Elemento | Regra |
|---|---|
| Tipografia UI | `font-sans`, 13–14px. Fonte de sistema — sem webfont, sem flash de carregamento. |
| Tipografia de dado | `font-mono` **sempre**. Chave, valor, célula de tabela, SQL. |
| Sombra | Praticamente nenhuma. Hierarquia vem de superfície + borda de 1px. No máximo um `shadow-sm` em popover e modal. |
| Raio | 6px em controles, 8px em painéis. Nada arredondado demais. |
| Densidade | Linha de dado com 28–32px de altura. Isto é território TablePlus/Proxyman, não app de consumidor. |
| Movimento | Só o que comunica dado mudando: highlight de linha com fade de 600ms. Nada mais anima. |
| Ícones | Lucide, 16px, `stroke-width: 1.5`. Traço fino combina com a leveza. |
| Foco | Anel de acento visível em tudo que é focável. Navegação por teclado é requisito, não extra. |

## 4.4 Vocabulário visual do dado

Consistente em toda a UI — timeline, lista de chaves, grid de linhas:

- **Criado** → ponto/borda esquerda em `--created`
- **Atualizado** → `--updated` (coral)
- **Removido** → `--deleted`, com o valor em `line-through` e opacidade reduzida
- **Origem app** → ponto neutro (`--text-subtle`)
- **Origem Studio** → ponto coral preenchido

Distinguir "eu fiz isso" de "o app fez isso" é o que evita perder uma hora confundindo os
dois enquanto se debuga.

---

# 5. Arquitetura de informação

## 5.1 A inversão

O documento original organiza tudo por provider (`Storage > MMKV > default`). Isso enterra
os três diferenciais, que são todos cross-provider. A estrutura correta:

```text
┌────────────────────────────────────────────────────────────────────┐
│  app-proline          Pixel 8 ● conectado         ⌘K       ☾  │  ← topo
├──────────────┬─────────────────────────────────────────────────────┤
│              │                                                     │
│  MMKV        │                                                     │
│   default    │        Área de trabalho                             │
│   user       │        (chaves, tabelas, editor)                    │
│              │                                                     │
│  AsyncStorage│                                                     │
│              │                                                     │
│  SQLite      │                                                     │
│   proline.db │                                                     │
│              │                                                     │
├──────────────┴─────────────────────────────────────────────────────┤
│  Atividade                          ⏺ gravar   ⌫ limpar   ⌃  │  ← dockado
│  14:32:07  MMKV          auth.token       removido      ● app      │
│  14:32:07  AsyncStorage  user.session     removido      ● app      │
│  14:32:06  SQLite        visits           3 linhas      ● app      │
└────────────────────────────────────────────────────────────────────┘
```

**A faixa de Atividade é persistente**, dockada no rodapé, visível independente de onde
você navegou. Modelo mental: o Console do Chrome DevTools. Colapsável com `⌃`, nunca um
destino de navegação.

A sidebar já lista providers e instâncias descobertos — sem tela de Overview intermediária.
Overview e Storage eram a mesma tela.

## 5.2 Telas

### Aguardando conexão — a tela mais importante do produto

É a primeira que todo usuário vê. Num produto que se vende como plug-n-play, é onde a
promessa se cumpre ou quebra. **Não pode ser um spinner.** Tem que ser diagnóstica:

```text
        Aguardando o app conectar…

        ✓  Metro rodando na porta 8081
        ✓  Encontrei no seu package.json:
             react-native-mmkv
             @react-native-async-storage/async-storage
             expo-sqlite
        ✓  adb reverse configurado

        Abra ou recarregue o app no simulador.
```

Se a detecção falhar, esta tela é a única chance de salvar o usuário. Cada linha
verificada, com o que fazer quando falha.

### Key-value

Três colunas: **Chaves | Editor | Histórico da chave**.

A terceira coluna **não** é um painel de metadata com quatro campos — isso é desperdício de
uma coluna inteira. Metadata (tipo, tamanho, origem, atualizado) vira faixa fina acima do
editor. A coluna vira o histórico *daquela chave*: "mudou 4 vezes no último minuto", com
valores anteriores clicáveis. É o diferencial do produto aplicado no nível da chave.

**Editor por tipo — não um editor de código para tudo:**

| Tipo | Controle |
|---|---|
| boolean | toggle |
| number | input numérico |
| string | input de uma linha |
| JSON | CodeMirror com validação e format |
| buffer | hex/base64, read-only no MVP |

Seletor de tipo **explícito e sempre visível** ao lado do valor. Isto não é enfeite: o MMKV
não tem API de introspecção de tipo, e sem isso editar `123` pode silenciosamente gravar
`"123"` e quebrar o app. O risco de runtime se resolve na UI, virando decisão consciente.

### SQLite

Tabelas | Grid de linhas | Console SQL colapsado.

Edição de célula exige identidade estável: rowid, ou PK detectada via `PRAGMA table_info`.
Sem nenhum dos dois (`WITHOUT ROWID`, views), a tabela é read-only, e a UI diz o porquê.

Console SQL é recurso avançado — colapsado por padrão, com `LIMIT` implícito e confirmação
em operação destrutiva.

### Busca global (⌘K)

Cross-storage, simultânea em MMKV + AsyncStorage + SQLite. Responde a pergunta que o dev
realmente faz: *"onde diabos está guardado esse valor?"*.

Cai de graça da arquitetura unificada e ninguém tem.

## 5.3 Estados obrigatórios

Nenhuma tela é considerada pronta sem: desconectado, reconectando, vazio, carregando,
valor truncado, erro de escrita, erro de SQL, nenhum provider detectado.

---

# 6. Fases

Cada fase tem **critério de saída verificável**. Sem critério atendido, a fase não acabou.

## Fase 0 — Esqueleto que anda

Prova o mais difícil primeiro: shim → runtime → WS → UI. Um valor só, sem provider real.

- Reestruturar em monorepo pnpm (mover raiz atual para `apps/desktop/`)
- `packages/protocol`: Zod, handshake, versionamento, token de sessão
- `packages/runtime`: bootstrap, transport, registry
- `apps/cli`: wrapper do Metro, WS server, serve estático, `adb reverse`, detecção de deps
- `apps/desktop`: shell da UI, design system da §4, claro/escuro funcionando
- `apps/playground`: Expo app com as três libs
- Shim mínimo provando a interceptação
- **Teste de CI que falha se símbolo do inspector aparecer em bundle de produção**

> **Saída:** `pnpm rn-storage-inspector` sobe o Metro, o app conecta sozinho, e uma chave
> fake aparece na UI e atualiza ao vivo. Sem nenhuma linha de código no app.

## Fase 1 — AsyncStorage + Timeline

O provider mais simples pareado com a feature mais importante — a feature precisa de um
provider real para existir, e este é o mais seguro para construí-la em cima.

- Shim do AsyncStorage
- CRUD completo
- **Faixa de Atividade dockada**, com origem app/Studio
- Supressão de eco
- Contract tests de key-value em `packages/testkit`

> **Saída:** o GIF. Tocar "logout" no simulador e ver as chaves limparem ao vivo na
> Atividade. Se esse GIF não gravável, a fase não acabou — ele é o marketing inteiro.

## Fase 2 — MMKV + auto-discovery

- Shim do construtor, descoberta completa de instâncias
- Inferência de tipo + editores por tipo (§5.2)
- Listeners
- Contract tests passando idênticos aos do AsyncStorage

> **Saída:** playground com três instâncias MMKV, uma delas encriptada e uma criada dentro
> de uma lib de terceiro. Nenhuma registrada manualmente. As três aparecem.

## Fase 3 — SQLite

- Shim do `openDatabase*` forçando `enableChangeListener`
- Schema, paginação, ordenação, filtro
- Edição por rowid/PK, insert, delete
- Console SQL com `LIMIT` e confirmação
- Change listener → re-query da linha

> **Saída:** editar célula reflete no app; insert/update/delete aparecem na Atividade;
> tabela sem PK entra em read-only explicando o motivo.

## Fase 4 — O que faz virar produto

- Busca global ⌘K cross-storage
- Diff de JSON no timeline (o que mudou *dentro* do valor)
- Modo gravação (start → fluxo no app → stop)
- Filtro e pin no timeline
- Todos os estados da §5.3
- Reconexão, erros estruturados, coalescing
- README com o GIF

> **Saída:** um dev de fora instala e usa sem pedir ajuda. Testado com alguém de verdade,
> observando em silêncio.

## Fase 5 — Alpha no app-proline

Dogfooding no projeto real. É o último critério de sucesso do doc original — "útil em um
projeto real, não apenas no playground" — e o único que importa de verdade.

Aqui entram, se a realidade pedir: iPhone físico, `op-sqlite`, SecureStore.

---

# 7. Quando o Tauri volta

Gatilho definido, não "algum dia". Qualquer um dos dois:

- Pedidos reais de usuários por app desktop
- Necessidade concreta que o browser não atende: tray icon, atalho global, notificação
  nativa, múltiplas janelas, sobreviver a restart do Metro

Enquanto nenhum disparar, `src-tauri/` fica parado sem custo de manutenção. Com D5
respeitada, ligar é trocar o alvo de build — não uma migração.

---

# 8. Riscos vivos

| Risco | Mitigação |
|---|---|
| Shim vaza para bundle de produção | Teste de CI bloqueante desde a Fase 0. Inegociável. |
| Metro + symlinks pnpm no playground | Reservar tempo na Fase 0. Plano B: `node-linker=hoisted`. |
| Overhead do shim degrada MMKV em dev | Wrapper fino, sem serialização ansiosa. Medir na Fase 2. |
| Callstack copia o auto-discovery | Provável, ~1 semana de trabalho para eles. Moat é posicionamento (produto especialista vs. plataforma), não tecnologia. Aceito conscientemente — D1 diz que não há receita a defender. |
| Escopo vaza para network/redux/etc | §1 não-objetivos. Reler antes de cada fase. |
| Volume de mudanças derrete a UI | Coalescing e teto de taxa na Fase 4, testado com loop de sync sintético. |

---

# 9. Se precisar cortar

Ordem de corte, do primeiro ao último:

1. Console SQL
2. Duplicar valor
3. Renomear chave
4. Modo gravação
5. Diff de JSON

**Nunca cortar:** o timeline. É a única coisa aqui que ninguém mais faz de graça.
