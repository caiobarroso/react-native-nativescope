# React Native Storage Inspector

Inspetor de dados locais para React Native — MMKV, AsyncStorage e SQLite,
ao vivo, sem configuração.

```bash
pnpm add -D react-native-storage-inspector
pnpm rn-storage-inspector
```

100% local. Nenhum dado sai da sua máquina.

> **Status: Fases 0–3 implementadas.** AsyncStorage, MMKV (auto-discovery
> por construtor) e SQLite (schema, grid editável, console SQL) funcionando
> de ponta a ponta com atividade em tempo real. Falta validação em
> simulador/device. Ver [docs/plano-de-execucao.md](docs/plano-de-execucao.md).

## Monorepo

| Pacote | O quê |
|---|---|
| `apps/cli` | O pacote público: CLI, serviço local (WS + UI), shims do Metro |
| `apps/desktop` | A UI do Studio (cliente web puro; casca Tauri estacionada) |
| `apps/playground` | App Expo real para testar em simulador (fora do workspace) |
| `packages/protocol` | Contratos do fio: schemas Zod, commands, events, versão |
| `packages/runtime` | SDK que roda dentro do app: transport, registry, adapters |

## Desenvolvimento

```bash
pnpm install
pnpm -r test                     # unitários + integração
pnpm --filter @rnsi/desktop build
node apps/cli/dist/cli.mjs --fake --no-open   # sobe com runtime simulado
```

`--fake` conecta um app falso que gera atividade — útil para desenvolver a
UI sem simulador.

## Regras que o CI garante

- Nenhum import de `@tauri-apps/*` na UI (D5 — a UI é um cliente web puro).
- O shim jamais aparece em bundle de release (`scripts/check-release-bundle.mjs`).
