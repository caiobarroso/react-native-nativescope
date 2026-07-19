# RN Studio

## MVP - Documento de Produto, Escopo e Arquitetura Técnica

Uma proposta para construir um inspetor universal de dados locais para aplicações React Native.

> **Problema:** inspecionar dados locais em apps React Native ainda é fragmentado, manual e pouco confiável.
>
> **Produto:** ferramenta desktop 100% local para visualizar, editar e acompanhar em tempo real MMKV, AsyncStorage e SQLite.
>
> **Princípios:** zero configuration, 100% local, realtime e simplicidade para evoluir.

---

# 1. A dor

Hoje, inspecionar os dados de uma aplicação React Native exige uma combinação pouco elegante de ferramentas: Flipper, plugins inconsistentes, `adb shell`, `console.log`, consultas SQL manuais, navegação de arquivos e inspeções improvisadas dentro do próprio app.

O desenvolvedor perde tempo, aumenta a chance de erro e não possui um único lugar para entender o estado real da aplicação.

## Principais dores observadas

- Não existe uma experiência única e coesa para dados locais no ecossistema React Native.
- MMKV, AsyncStorage e SQLite costumam ser inspecionados de maneiras completamente diferentes.
- Editar dados durante o desenvolvimento ainda é uma experiência frágil e pouco visual.
- Ferramentas atuais raramente oferecem um bom modelo de realtime entre o app e a interface de inspeção.
- Boa parte do debugging ainda acontece por tentativas, logs e scripts improvisados.

## Hipótese de valor

Se entregarmos uma ferramenta desktop, local e simples, capaz de detectar automaticamente os principais storages do projeto e expor uma interface consistente para leitura, edição e acompanhamento em tempo real, a produtividade do time aumenta e o debugging fica mais previsível.

---

# 2. O produto

**RN Studio** é um inspetor de dados locais para React Native.

No MVP, ele foca em um problema muito bem definido: permitir que o desenvolvedor visualize, pesquise, edite e acompanhe em tempo real os dados armazenados em:

- MMKV
- AsyncStorage
- SQLite, inicialmente por meio do Expo SQLite

## Promessa central do MVP

- Instalou, abriu, funcionou.
- Nenhum dado sai da máquina do desenvolvedor.
- Mudanças feitas no Studio refletem imediatamente no storage da aplicação.
- Quando a tecnologia suportar reatividade, o próprio app também reflete a mudança automaticamente.
- A interface é consistente independentemente do provider.

## Escopo do MVP

### Em escopo

- MMKV
- AsyncStorage
- Expo SQLite
- Detecção automática de dependências
- Leitura de dados
- Pesquisa
- Criação
- Edição
- Exclusão
- Realtime
- Interface desktop
- CLI local
- Runtime SDK para React Native
- Comunicação local entre app e desktop

### Fora do MVP

- Network inspector
- Logs
- Localização
- Notificações
- Performance avançada
- Autenticação
- Nuvem
- Colaboração remota
- Redux
- Zustand
- WatermelonDB
- Suporte amplo a state managers

Esses módulos podem ser adicionados futuramente, depois da validação do produto principal.

---

# 3. Princípios de experiência

## 3.1 Zero configuration por padrão

O fluxo ideal deve exigir apenas um pacote e um comando.

```bash
pnpm add -D react-native-storage-inspector
pnpm react-native-storage-inspector
```

A ferramenta deve detectar automaticamente o máximo possível.

Quando uma tecnologia não permitir acesso automático à instância em runtime, a integração manual deve ser mínima e explícita.

Exemplo aceitável para um caso especial:

```ts
studio.registerDatabase(database);
```

Essa deve ser a exceção, não o fluxo principal.

## 3.2 100% local e privado

- Sem cloud
- Sem login
- Sem conta
- Sem API key
- Sem analytics obrigatórios
- Sem telemetria habilitada por padrão
- Sem armazenamento remoto
- Sem envio de dados da aplicação

Toda comunicação deve acontecer localmente entre:

1. Aplicação React Native
2. Serviço local
3. Aplicação desktop

A promessa pública deve ser tecnicamente verdadeira:

> Seus dados nunca saem da sua máquina.

E também:

> Nós tecnicamente não temos acesso aos dados da sua aplicação.

## 3.3 Realtime

O Studio deve reagir a mudanças quase instantaneamente e dar feedback visual claro.

Exemplos:

- Uma chave MMKV mudou no app: a linha correspondente pisca no Studio.
- Uma linha foi inserida no SQLite: a nova linha aparece e recebe destaque.
- Um valor foi alterado pelo Studio: o app recebe a mudança imediatamente.

## 3.4 Simplicidade radical

A interface deve ser óbvia até para um desenvolvedor iniciante.

Evitar:

- Wizards longos
- Arquivos grandes de configuração
- Instalação manual de vários plugins
- Termos arquiteturais expostos ao usuário
- Fluxos diferentes para cada provider

## 3.5 Arquitetura evolutiva

O MVP começa pequeno, mas deve permitir a adição futura de novos providers sem reescrever o produto.

---

# 4. Fluxo ideal do usuário

```bash
pnpm add -D react-native-storage-inspector
pnpm react-native-storage-inspector
```

Resultado esperado:

1. A CLI identifica se o projeto usa React Native CLI ou Expo.
2. A CLI analisa `package.json` e os lockfiles.
3. Detecta MMKV, AsyncStorage e Expo SQLite.
4. Inicia o serviço local.
5. Conecta o runtime React Native.
6. Abre a aplicação desktop Tauri.
7. Exibe automaticamente os providers disponíveis.

Exemplo de saída:

```text
React Native Storage Inspector

Project detected: app-proline
Runtime: Expo Development Build

Detected providers:
✓ MMKV
✓ AsyncStorage
✓ Expo SQLite

Local service running at ws://127.0.0.1:4782
Opening desktop application...
```

---

# 5. Protótipo low-fi

Os protótipos abaixo são deliberadamente simples. O objetivo é comunicar estrutura e fluxo, não definir o design final.

## 5.1 Dashboard

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Project: app-proline        Device: Pixel 8        ● Connected       │
├───────────────────┬───────────────────────────────────────────────────┤
│                   │                                                   │
│ Overview          │  ┌────────────┐ ┌──────────────┐ ┌────────────┐ │
│ Storage           │  │ MMKV       │ │ AsyncStorage │ │ SQLite     │ │
│ Realtime          │  │ 42 keys    │ │ 18 keys      │ │ 6 tables   │ │
│ Settings          │  └────────────┘ └──────────────┘ └────────────┘ │
│                   │                                                   │
│                   │  Live activity                                    │
│                   │  ┌─────────────────────────────────────────────┐  │
│                   │  │ MMKV user.token updated                   │  │
│                   │  │ SQLite visits row inserted                │  │
│                   │  │ AsyncStorage syncQueue changed            │  │
│                   │  └─────────────────────────────────────────────┘  │
└───────────────────┴───────────────────────────────────────────────────┘
```

## 5.2 Key-value inspector

```text
Storage > MMKV > default

┌──────────────────────┬──────────────────────────────────┬──────────────┐
│ Keys                 │ Value editor                     │ Metadata     │
├──────────────────────┼──────────────────────────────────┼──────────────┤
│ auth.token           │ {                                │ type: JSON   │
│ user.profile         │   "name": "Caio",              │ size: 3.2 KB │
│ feature.flags        │   "premium": false              │ source: app  │
│ sync.queue           │ }                                │ updated: 1s  │
│ device.info          │                                  │              │
│                      │ [Save] [Delete] [Duplicate]      │              │
└──────────────────────┴──────────────────────────────────┴──────────────┘
```

## 5.3 SQLite browser

```text
Storage > SQLite > proline.db > visits

┌──────────────┬────────────────────────────────────────────────────────┐
│ Tables       │ Rows                                                   │
├──────────────┼────┬─────────┬───────────┬────────────┬────────────────┤
│ visits       │ id │ status  │ startedAt │ finishedAt │ pdv            │
│ tasks        ├────┼─────────┼───────────┼────────────┼────────────────┤
│ photos       │ 1  │ done    │ 08:00     │ 08:37      │ Carrefour      │
│ users        │ 2  │ pending │ -         │ -          │ Pague Menos    │
│ queue        │ 3  │ done    │ 09:05     │ 09:44      │ Atacadão       │
└──────────────┴────┴─────────┴───────────┴────────────┴────────────────┘

SQL console
┌───────────────────────────────────────────────────────────────────────┐
│ SELECT * FROM visits WHERE status = 'pending';                [Run] │
└───────────────────────────────────────────────────────────────────────┘
```

---

# 6. Funcionalidades do MVP

## 6.1 Capacidades comuns

- Listar providers detectados
- Listar instâncias
- Listar chaves, tabelas e registros
- Buscar por nome, chave ou valor
- Abrir valores em modo de leitura
- Editar valores
- Criar novos valores ou linhas
- Excluir valores ou registros
- Duplicar valores quando fizer sentido
- Renomear chaves quando suportado
- Mostrar o tipo do valor
- Mostrar tamanho aproximado
- Mostrar origem da última mudança
- Destacar mudanças recentes
- Informar erros de forma clara
- Reconectar automaticamente

## 6.2 MMKV

- Detectar a dependência instalada
- Detectar ou registrar instâncias
- Listar todas as chaves
- Ler strings, números, booleanos, buffers e JSON serializado
- Criar chaves
- Editar valores
- Excluir chaves
- Renomear por meio de copiar + remover
- Escutar alterações via listeners
- Atualizar o Studio em realtime

## 6.3 AsyncStorage

- Detectar a dependência instalada
- Listar chaves com `getAllKeys()`
- Ler valores individualmente ou em lote
- Criar chaves
- Editar valores
- Excluir chaves
- Renomear por meio de copiar + remover
- Instrumentar chamadas de escrita em desenvolvimento
- Usar polling ou comparação de snapshots apenas como fallback

## 6.4 SQLite

Implementação inicial por meio do Expo SQLite.

- Detectar bancos registrados
- Listar bancos
- Listar tabelas
- Listar colunas e tipos
- Paginar registros
- Ordenar
- Filtrar
- Pesquisar
- Editar células
- Inserir registros
- Excluir registros
- Executar SQL manual
- Exibir erros SQL
- Escutar eventos de mudança
- Reconsultar a linha alterada
- Destacar inserts e updates visualmente

---

# 7. Realtime no MVP

## 7.1 Objetivo

Chegar o mais próximo possível da sensação do Firebase:

> Uma mudança acontece e a interface responde imediatamente.

## 7.2 Fluxo Studio para app

```text
Usuário altera um valor no Studio
        ↓
Desktop envia um command
        ↓
Serviço local valida a mensagem
        ↓
Runtime React Native recebe
        ↓
Adapter executa set/insert/update/delete
        ↓
Provider confirma a alteração
        ↓
Runtime emite um event
        ↓
Studio confirma e destaca a linha
```

## 7.3 Fluxo app para Studio

```text
Aplicação altera o storage
        ↓
Adapter detecta a mudança
        ↓
Runtime normaliza o evento
        ↓
WebSocket local
        ↓
Desktop atualiza somente o item afetado
        ↓
Linha recebe destaque temporário
```

## 7.4 Viabilidade por provider

| Provider | Studio detecta mudanças do app | Studio altera o dado | App reage automaticamente |
|---|---|---|---|
| MMKV | Sim, via listeners | Sim | Em geral sim, quando o app usa hooks ou listeners adequados |
| AsyncStorage | Parcial, via instrumentação e fallback | Sim | Não universal; depende de como o app carrega os dados |
| SQLite | Sim, via change listener e reconsulta | Sim | Depende de live queries, observables ou invalidação de cache |

## 7.5 Promessa correta do MVP

O produto pode prometer:

> Todas as alterações aparecem instantaneamente no Studio.

E também:

> Alterações feitas no Studio são aplicadas imediatamente ao storage do aplicativo.

Não deve prometer universalmente:

> Qualquer tela do aplicativo será renderizada novamente automaticamente.

Isso depende da arquitetura do aplicativo inspecionado.

---

# 8. Arquitetura proposta

## 8.1 Visão geral

```text
┌──────────────────────────────┐
│ Desktop                      │
│ Tauri + React + TypeScript   │
└──────────────┬───────────────┘
               │ WebSocket local
┌──────────────▼───────────────┐
│ CLI / Local Service          │
│ Node.js + TypeScript         │
└──────────────┬───────────────┘
               │ Studio Protocol
┌──────────────▼───────────────┐
│ Runtime SDK                  │
│ React Native + TypeScript    │
└──────────────┬───────────────┘
               │ Capabilities
┌──────────────▼───────────────┐
│ Adapters                     │
│ MMKV / AsyncStorage / SQLite │
└──────────────────────────────┘
```

## 8.2 Modelo arquitetural

A recomendação é:

> Monólito modular em monorepo, com Ports and Adapters nas fronteiras, protocolo baseado em Commands e Events, e adapters orientados a capabilities.

Isso evita tanto o acoplamento excessivo quanto o overengineering.

## 8.3 Responsabilidades por camada

### Desktop

- Renderizar a interface
- Gerenciar navegação e estado visual
- Mostrar providers, instâncias, chaves e tabelas
- Enviar commands
- Receber events
- Destacar mudanças
- Nunca acessar um storage diretamente

### CLI / Serviço local

- Detectar o projeto
- Ler `package.json` e lockfiles
- Identificar Expo ou React Native CLI
- Detectar providers instalados
- Iniciar o WebSocket
- Gerenciar sessões
- Realizar handshake
- Fazer a ponte entre desktop e runtime
- Descobrir simuladores e dispositivos
- Abrir a aplicação desktop

### Runtime SDK

- Executar apenas em desenvolvimento
- Registrar adapters
- Expor capabilities
- Receber commands
- Executar operações
- Escutar mudanças
- Emitir events
- Manter impacto mínimo na aplicação

### Adapters

- Implementar a integração específica de cada provider
- Declarar capabilities
- Normalizar valores
- Executar operações
- Traduzir mudanças para eventos padronizados

---

# 9. Stack técnica

| Camada | Stack recomendada | Motivo |
|---|---|---|
| Desktop | Tauri + React + Vite + TypeScript | Leve, moderna e suficiente para o escopo |
| Estilos | Tailwind CSS | Familiaridade, velocidade e consistência visual |
| Estado remoto/runtime | TanStack Query | Cache, invalidação, loading e sincronização |
| Estado local da UI | Zustand | Simples para filtros, seleção, layout e preferências |
| Editor JSON/SQL | Monaco Editor | Experiência técnica madura |
| CLI e serviço local | Node.js + TypeScript | Integração natural com o ecossistema React Native |
| Comunicação | WebSocket local | Bidirecional e em tempo real |
| Validação | Zod | Schema e tipos TypeScript na mesma fonte |
| Runtime | TypeScript | Baixo atrito para projetos React Native |
| Monorepo | pnpm workspaces | Dependências mais rígidas e boa organização |
| Unitários | Vitest | Rápido e adequado para TypeScript |
| E2E desktop | Playwright | Testes de fluxos reais da UI |
| Integração RN | Playground app | Testes reais em Android e iOS |

---

# 10. Por que Tauri

O produto é uma ferramenta que deve permanecer aberta durante o desenvolvimento.

O Tauri se alinha melhor com a proposta por oferecer:

- Instalador menor
- Menor consumo de RAM
- Menor consumo de CPU
- Uso da WebView nativa do sistema
- Integrações nativas por Rust quando necessário
- Aplicação React no frontend

O Rust deve inicialmente ficar restrito a:

- Janela desktop
- Menus
- Atalhos
- Permissões nativas
- Inicialização do sidecar
- Atualizações futuras

A lógica de negócio principal deve permanecer em TypeScript no MVP.

---

# 11. Por que pnpm

O produto será naturalmente um monorepo com vários pacotes internos.

Principais benefícios:

- Workspaces explícitos
- Uso de `workspace:*`
- Menor risco de dependências fantasmas
- Lockfile único
- Boa preparação para publicar pacotes no npm
- Instalações eficientes
- Facilidade para compartilhar configurações

---

# 12. Estrutura do monorepo

```text
react-native-storage-inspector/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   └── src-tauri/
│   ├── cli/
│   └── playground/
│
├── packages/
│   ├── protocol/
│   ├── core/
│   ├── runtime/
│   └── testkit/
│
├── tooling/
│   ├── eslint-config/
│   └── tsconfig/
│
├── docs/
│   └── adr/
│
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── tsconfig.json
```

## 12.1 `apps/desktop`

```text
apps/desktop/src/
├── app/
│   ├── router/
│   ├── providers/
│   └── App.tsx
│
├── features/
│   ├── connections/
│   ├── key-value/
│   ├── databases/
│   └── settings/
│
├── shared/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── styles/
│
└── main.tsx
```

Organizar por feature, evitando uma estrutura global genérica como:

```text
components/
hooks/
services/
pages/
utils/
```

## 12.2 `apps/cli`

```text
apps/cli/src/
├── commands/
├── discovery/
├── server/
├── sessions/
├── devices/
└── index.ts
```

## 12.3 `packages/protocol`

```text
packages/protocol/src/
├── commands/
├── events/
├── schemas/
├── errors/
├── version.ts
└── index.ts
```

## 12.4 `packages/core`

```text
packages/core/src/
├── capabilities/
├── adapters/
├── registry/
├── commands/
├── events/
└── errors/
```

O core deve ser TypeScript puro, sem imports de:

- React
- React Native
- Tauri
- Node.js
- MMKV
- AsyncStorage
- Expo SQLite

## 12.5 `packages/runtime`

```text
packages/runtime/src/
├── bootstrap/
├── registry/
├── transport/
├── command-handler/
├── change-feed/
└── adapters/
    ├── async-storage/
    ├── mmkv/
    └── expo-sqlite/
```

## 12.6 `packages/testkit`

```text
packages/testkit/
├── contracts/
├── fakes/
└── fixtures/
```

---

# 13. Padrões de projeto

## 13.1 Monólito modular

Um único produto e um único repositório, com módulos bem separados.

Evitar microserviços e distribuição prematura.

## 13.2 Ports and Adapters

O core define o contrato. Cada provider implementa o comportamento concreto.

```text
Core: quero alterar uma chave
MMKVAdapter: chama storage.set()
AsyncStorageAdapter: chama AsyncStorage.setItem()
```

## 13.3 Capability-based design

Não forçar SQLite e MMKV a implementarem a mesma interface gigante.

Exemplo:

```ts
type Capability =
  | 'key-value.read'
  | 'key-value.write'
  | 'key-value.watch'
  | 'database.query'
  | 'database.mutate'
  | 'database.watch';
```

Manifesto MMKV:

```ts
const mmkvManifest = {
  id: 'mmkv',
  capabilities: [
    'key-value.read',
    'key-value.write',
    'key-value.watch',
  ],
};
```

Manifesto SQLite:

```ts
const sqliteManifest = {
  id: 'expo-sqlite',
  capabilities: [
    'database.query',
    'database.mutate',
    'database.watch',
  ],
};
```

## 13.4 Command and Event

Commands representam intenções:

```text
key-value.set
key-value.remove
database.insert
database.update
database.delete
database.execute
```

Events representam fatos que já aconteceram:

```text
key-value.changed
database.row-inserted
database.row-updated
database.row-deleted
connection.opened
connection.closed
```

## 13.5 SOLID com pragmatismo

| Princípio | Aplicação prática |
|---|---|
| SRP | Cada adapter cuida de uma tecnologia |
| OCP | Novo adapter entra sem alterar o core |
| LSP | Adapters passam por contract tests comuns |
| ISP | Interfaces pequenas por capability |
| DIP | Core depende de contratos, não de providers |

Não usar SOLID como justificativa para criar dezenas de camadas vazias.

Preferir funções puras, factories e composição.

---

# 14. Contratos do protocolo

Toda mensagem deve ter um formato previsível e validado.

## Exemplo de command

```json
{
  "protocolVersion": 1,
  "requestId": "request-123",
  "sessionId": "session-456",
  "type": "key-value.set",
  "payload": {
    "providerId": "mmkv",
    "instanceId": "default",
    "key": "user.profile",
    "value": {
      "name": "Caio",
      "premium": true
    }
  }
}
```

## Exemplo de event

```json
{
  "protocolVersion": 1,
  "sessionId": "session-456",
  "type": "key-value.changed",
  "payload": {
    "providerId": "mmkv",
    "instanceId": "default",
    "key": "user.profile",
    "source": "app",
    "timestamp": 1752860000
  }
}
```

## Regras

- Toda mensagem externa passa por validação Zod.
- A UI não confirma definitivamente uma alteração antes da resposta do runtime.
- Commands devem possuir `requestId`.
- Events devem indicar a origem: `app` ou `studio`.
- O protocolo deve ser versionado.
- Erros devem ser estruturados e serializáveis.

---

# 15. Estratégia de testes

## 15.1 Objetivo

Adicionar um novo provider no futuro deve ser um trabalho majoritariamente local ao adapter e aos testes.

O restante do sistema deve permanecer estável.

## 15.2 Testes unitários

Cobrir:

- Schemas Zod
- Serialização
- Parsing
- Registries
- Detecção de dependências
- Command handlers
- Event normalization
- Capabilities
- Session management
- Reconexão

Ferramenta: **Vitest**.

## 15.3 Contract tests

A mesma suíte deve validar todos os adapters da mesma categoria.

Exemplo:

```ts
describeKeyValueAdapterContract({
  name: 'AsyncStorage',
  createAdapter: createAsyncStorageTestAdapter,
});
```

E para MMKV:

```ts
describeKeyValueAdapterContract({
  name: 'MMKV',
  createAdapter: createMMKVTestAdapter,
});
```

Contrato mínimo:

- Lista chaves
- Lê valores corretamente
- Preserva tipos
- Cria valores
- Atualiza valores
- Remove valores
- Renomeia sem perder dados
- Emite eventos
- Não duplica eventos
- Distingue app e Studio
- Trata erros
- Mantém consistência após falha

## 15.4 Testes de integração

Criar um app React Native real em `apps/playground` com:

- AsyncStorage
- MMKV
- Expo SQLite

Executar em:

- Android Emulator
- iOS Simulator

## 15.5 E2E desktop

Usar Playwright para testar:

- Abrir o Studio
- Conectar ao runtime falso
- Listar providers
- Listar chaves
- Editar valor
- Receber evento
- Destacar linha
- Mostrar erro
- Desconectar
- Reconectar

## 15.6 Smoke tests do Tauri

Manter poucos testes específicos do shell nativo.

A maior parte da lógica deve ser testável fora do Tauri.

---

# 16. Regras contra overengineering

1. Nada entra no core se for específico de uma tecnologia.
2. Nenhum componente React acessa WebSocket diretamente.
3. Nenhum adapter importa outro adapter.
4. Toda mensagem externa passa por schema.
5. Todo adapter novo passa por contract tests.
6. Não criar abstração antes de existir um segundo caso real.
7. Não usar classe base para adapters.
8. Não criar pacote npm separado sem necessidade real.
9. Não duplicar lógica entre Node e Rust.
10. Decisões arquiteturais importantes recebem um ADR curto.
11. Não criar DI container no MVP.
12. Não criar microserviços.
13. Não implementar recursos fora do escopo antes de validar storage.

---

# 17. ADRs iniciais

```text
docs/adr/
├── 001-use-tauri.md
├── 002-use-node-local-service.md
├── 003-use-websocket-protocol.md
├── 004-use-capability-based-adapters.md
├── 005-use-pnpm-workspaces.md
└── 006-keep-all-data-local.md
```

Formato de cada ADR:

```text
Contexto
Decisão
Alternativas consideradas
Consequências
```

---

# 18. Plano de entrega sugerido

## Fase 0 - Fundação

- Criar monorepo pnpm
- Criar desktop Tauri
- Configurar React, Vite, TypeScript e Tailwind
- Criar CLI mínima
- Criar protocol package
- Criar runtime bootstrap
- Criar playground app
- Definir conexão local inicial

## Fase 1 - AsyncStorage

- Primeiro fluxo end-to-end completo
- Listar chaves
- Ler valores
- Editar
- Criar
- Excluir
- Sincronizar com a UI
- Criar contract tests de key-value

## Fase 2 - MMKV

- Detectar instâncias
- Implementar tipos
- Implementar listeners
- Realtime de alta qualidade
- Testar múltiplas instâncias

## Fase 3 - SQLite

- Registrar bancos
- Listar tabelas
- Ler schema
- Paginar linhas
- Editar registros
- Inserir e excluir
- Criar console SQL
- Escutar eventos de mudança

## Fase 4 - Hardening

- Testes iOS e Android
- Reconexão
- Erros estruturados
- Performance
- Documentação
- UX refinada
- Segurança local

## Fase 5 - Alpha privada

- Validar em projetos reais
- Observar dificuldades de instalação
- Medir qualidade da detecção automática
- Coletar feedback de desenvolvedores iniciantes e experientes
- Ajustar o posicionamento do produto

---

# 19. Riscos principais

## 19.1 Detecção automática de instâncias

Detectar a dependência instalada não significa automaticamente encontrar todas as instâncias em runtime.

Mitigação:

- Automação primeiro
- Registro manual mínimo como fallback
- Mensagens claras
- Documentação específica por provider

## 19.2 Reatividade dentro do app

Alterar o storage não garante que qualquer tela seja renderizada novamente.

Mitigação:

- Promessa pública precisa
- Hooks opcionais de invalidation
- Capabilities explícitas
- Documentar diferenças por provider

## 19.3 SQLite

SQLite possui desafios maiores:

- Grandes volumes
- Paginação
- Queries lentas
- Transações
- Chaves compostas
- Tabelas sem `rowid`
- Deletes difíceis de reconstruir via listener

Mitigação:

- Começar com Expo SQLite
- Limitar queries por padrão
- Exigir confirmação para operações perigosas
- Implementar leitura de schema corretamente
- Tratar SQL console como recurso avançado

## 19.4 Conexão com dispositivos

A experiência precisa funcionar em:

- Android Emulator
- Android físico
- iOS Simulator
- iPhone físico

Mitigação:

- Camada de transport isolada
- `adb reverse` no Android quando aplicável
- Estratégia local de rede no iOS
- Handshake e autenticação local por sessão
- Comando `doctor`

---

# 20. Critérios de sucesso do MVP

O MVP pode ser considerado bem-sucedido quando:

- Um desenvolvedor instala sem assistência.
- O Studio abre com um único comando.
- AsyncStorage, MMKV e SQLite aparecem automaticamente em projetos comuns.
- O usuário consegue ler e editar dados.
- Alterações aparecem em tempo real no Studio.
- Nenhum dado sai da máquina.
- O mesmo produto funciona em apps iOS e Android.
- Os adapters passam por contract tests.
- A adição de um novo provider não exige reescrever a UI.
- A ferramenta é útil em um projeto real, não apenas no playground.

---

# 21. Conclusão

O MVP é enxuto, mas ambicioso no que realmente importa.

Em vez de tentar resolver todo o universo de DevTools de uma vez, ele ataca uma dor concreta e recorrente: inspecionar e manipular dados locais em aplicações React Native com uma experiência unificada, local, visual e em tempo real.

## Por que esta proposta é forte

- Resolve um problema real de forma clara.
- Começa com um escopo controlado.
- Possui diferenciais fortes: zero config, privacidade e realtime.
- A arquitetura é madura o suficiente para escalar.
- Evita overengineering.
- Cria uma base para módulos futuros como state, network, files, logs e performance.

> **Frase síntese:** React Native Storage Inspector é o lugar onde o desenvolvedor enxerga, entende e altera os dados locais do app sem fricção.
