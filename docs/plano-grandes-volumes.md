# Plano: Grandes Volumes de Dados ("GB-scale sem desespero")

> **Status: IMPLEMENTADO** (G1–G7, commits `6075522`…). Desvios conscientes:
> checksum é FNV-1a 32-bit (não sha256 — custo no device; integridade, não
> cripto); snapshots usam previews+flags de truncamento em vez de hash
> dedicado; Web Worker ficou desnecessário (payloads na main thread são
> bounded em 64 KB por chunk); backpressure é flush-antecipado no teto em
> vez de evento sync.pressure. ADR-0001 cobre a semântica de coalescing.

> Objetivo: um device com **vários GB** de dados locais deve ser inspecionável
> no Studio **sem gargalo perceptível**, com duas garantias invioláveis:
>
> 1. **A experiência do usuário nunca é afetada** — nem no app (JS thread
>    livre, memória O(página)), nem no Studio (60fps, sem travar aba).
> 2. **100% dos dados são acessíveis** — nada fica "escondido por limite";
>    todo dado truncado tem um caminho explícito para ser visto/baixado
>    por inteiro.

## 0. A tese (por que não existe "lib mágica")

Ferramentas que lidam bem com volumes gigantes — DataGrip, TablePlus,
Chrome DevTools, viewers de log — não usam nenhuma biblioteca especial de
"big data". Todas seguem a mesma disciplina, que é o coração deste plano:

**Os dados nunca saem do lugar. A UI é uma janela deslizante sobre eles.**

O contraexemplo é o Flipper: serializava payloads inteiros para o desktop e
ficou famoso por travar com apps reais. O Rozenite herda parte desse modelo.
Lidar com GB "como se não fosse nada" é, de fato, um diferencial — porque a
concorrência não faz.

A regra que decide qualquer dúvida de implementação daqui pra frente:

> **Custo de qualquer operação = O(o que está visível na tela),
> nunca O(tamanho do dataset).**

Se uma operação viola isso, ela está errada, mesmo que "funcione".

## 1. Orçamentos (budgets) — critérios objetivos de aceite

Estes números são o contrato. Todo PR desta iniciativa deve respeitá-los:

| Orçamento | Limite | Por quê |
|---|---|---|
| Mensagem WS individual | ≤ 256 KB | Nunca travar parse de JSON no Studio nem serialização no device |
| Memória extra no runtime (device) | O(1 página) ≈ ≤ 2 MB | O inspector jamais pode causar OOM no app do usuário |
| Bloqueio contínuo da JS thread do app | ≤ 8 ms por fatia | 60fps do app intocado; trabalho longo é fatiado com yields |
| Resposta percebida no Studio | ≤ 100 ms para dado visível | Preview imediato; exatidão (counts, full values) chega assíncrona |
| DOM no Studio | O(viewport) via virtualização | 1 milhão de keys = ~30 nós DOM |
| Payload de célula/valor na listagem | preview ≤ 4 KB + `size` + `truncated` | Lista nunca carrega o dado inteiro |

## 2. As cinco camadas da solução

### Camada A — Device: ler pouco, fatiado, e nunca bloquear

**A1. `key-value.listKeys` paginado e truncado na origem** *(o bug de OOM atual)*
- Hoje: `getAllKeys` + `multiGet` de TUDO → materializa o dataset inteiro
  na memória do app. Com GB, mata o app.
- Novo: `getAllKeys` (só strings de keys — barato mesmo com 1M de keys) →
  `multiGet` em lotes de 50 keys → truncar cada valor para preview de 4 KB
  **imediatamente**, antes de acumular → `await yield()` entre lotes
  (fatia ≤ 8 ms). Resposta carrega `{key, preview, size, truncated}`.
- MMKV: mesma coisa via `getAllKeys()` + get individual em lotes.
- Paginação por cursor de key (ordenação lexicográfica): `{afterKey, limit}`.

**A2. `key-value.get` devolve preview; valor completo é streaming**
- `get` → `{preview: 64KB, size, truncated}`.
- Valor completo via **streaming chunked** (Camada B), nunca numa mensagem só.

**A3. SQLite: keyset pagination + counts em duas fases + células lazy**
- `database.rows` troca `LIMIT/OFFSET` por **keyset**: `WHERE rowid > ?cursor
  ORDER BY rowid LIMIT ?n` — O(página) mesmo na página 100.000 (OFFSET é
  O(offset) e degrada linearmente).
- Count em duas fases: resposta imediata com estimativa
  (`MAX(rowid)` ou `PRAGMA`-stats, custo ~0) + `COUNT(*)` exato calculado
  assíncrono, fatiado, e cacheado por (tabela, geração de schema); UI mostra
  `~12.400` → atualiza para `12.417` quando o exato chegar.
- Células: truncadas em 4 KB no `rows`; novo comando `database.cell`
  (RowRef + coluna) busca a célula inteira via streaming — é assim que BLOBs
  de 200 MB ficam 100% acessíveis sem nunca passar pela listagem.

**A4. Backpressure e coalescing de eventos no runtime**
- Fila de saída com coalescing por chave (`key-value:instance:key`,
  `database:instance:table`): 10.000 writes/s no app viram no máximo
  ~10 eventos/s por chave para o Studio, com contador `coalescedCount`
  para a timeline não mentir sobre a quantidade.
- Fila com teto (ex.: 500 entradas); ao estourar, degrada para um evento
  `sync.pressure` e o Studio re-snapshot-a a janela visível ao aliviar.
- ⚠️ Muda a semântica de eventos que o `/app` também consome →
  exige o ADR curto já previsto (evento passa a significar "algo mudou
  nesta chave desde o último tick", não "cada mudança individual").

### Camada B — Transporte: streaming chunked no protocolo

Novo envelope no protocolo v1 (aditivo, não quebra nada):

```
stream.begin { streamId, kind, totalSize?, mime? }
stream.chunk { streamId, seq, data (≤ 64KB) }
stream.end   { streamId, ok, chunkCount, checksum }
stream.cancel{ streamId }            // Studio pode desistir a qualquer momento
```

- Usado por: `key-value.get-full`, `database.cell`, export de tabela/keys.
- Cancelável: usuário fechou o viewer → `stream.cancel` → device para de ler.
- Device envia chunks com yields entre leituras (respeita orçamento A).
- `checksum` no `end` é um **FNV-1a 32-bit** acumulado sobre o fluxo (não
  sha256 — calcular sha256 sobre GB na JS thread estouraria o próprio
  orçamento de fatia). O Studio recomputa e **compara** ao receber
  (`studio-client.ts`): divergência → "transferência corrompida". É detecção
  de corrupção **acidental** de transporte ponta-a-ponta — não é cripto nem
  garantia adversária. O "100% dos dados" vem da arquitetura (nada é truncado
  no caminho do stream), não do algoritmo de hash.

### Camada C — Studio: virtualizar tudo, pesado vai pra Worker

- **`@tanstack/react-virtual`** (a única lib nova de UI que vale adotar:
  ~2 KB, headless, casa com nosso design) em: lista de keys, RowGrid,
  timeline/atividade e resultados de busca. DOM constante independente
  do volume.
- **Web Worker** para `stableStringify`, diff de snapshots e formatação de
  JSON grande — a main thread do Studio nunca processa payload > 64 KB.
- Viewer de valor completo: carrega progressivamente via stream, com
  estado "truncado — carregar tudo (12,4 MB)" explícito. Acima de um teto
  de renderização (~10 MB), oferece **download** em vez de render inline.
- Snapshots: capturam previews + hashes (não valores inteiros); o diff
  compara hashes e só materializa (via stream) os valores que mudaram e
  que o usuário expandir.

### Camada D — Busca e export: computar onde o dado mora

- **Busca global roda no device**, não no Studio: SQL `LIKE`/scan de keys
  executado lá, fatiado com yields, devolvendo só matches (paginados).
  Buscar em 2 GB sem transferir 2 GB.
- **Export 100%**: `export` de tabela/instância inteira via stream →
  Studio grava direto em arquivo com File System Access API
  (`showSaveFilePicker` + `WritableStream`) — 2 GB fluem device → disco
  sem nunca residir na memória da aba. Este é o cumprimento literal do
  requisito "de uma forma ou de outra, acesso a 100% dos dados".

### Camada E — Prova: playground GB-scale + testes de orçamento

- Seeder no playground: `seed --keys 100k --big-values 50x10MB
  --sqlite-rows 5M --blob 200MB`.
- Testes de contrato novos: nenhuma resposta > 256 KB; `listKeys` em
  dataset sintético grande nunca materializa mais que 1 lote; keyset
  pagination devolve páginas estáveis sob escrita concorrente.
- Teste manual roteirizado: com 5M de linhas, scroll do RowGrid a 60fps,
  app respondendo a toque durante `listKeys`, export de 1 GB completando
  com hash válido.

## 3. Fases de execução (ordem = risco de dano hoje)

| Fase | Entrega | Resolve |
|---|---|---|
| **G1** | listKeys em lotes + truncamento na origem + cursor (A1) | O único caminho que hoje **mata o app** do usuário |
| **G2** | Protocolo `stream.*` + `get-full` + viewer truncado no Studio (A2, B, parte C) | "100% acessível" para valores grandes |
| **G3** | SQLite: keyset pagination + count 2 fases + `database.cell` (A3) | Tabelas de milhões de linhas fluidas |
| **G4** | Virtualização + Worker + snapshots por hash (C) | Studio leve com qualquer volume |
| **G5** | Coalescing/backpressure + ADR de semântica de eventos (A4) | Apps write-heavy; timeline honesta sob pressão |
| **G6** | Busca no device + export streaming p/ arquivo (D) | Diferencial visível: "buscou em 2 GB instantâneo" |
| **G7** | Seeder GB-scale + testes de orçamento no CI (E) | Garantia de que nunca regredimos |

Cada fase é commitável e útil sozinha; G1 é correção de segurança de
memória e vem antes de qualquer coisa.

## 4. O que NÃO vamos fazer (e por quê)

- **Comprimir tudo com deflate no WS** — CPU no device pelo ganho errado;
  o problema é volume transferido, e a solução é não transferir.
- **Cache espelho no Studio (IndexedDB/OPFS) do dataset** — duplicar GB no
  browser recria o problema do outro lado; cache só de previews/hashes.
- **Adotar framework de data-grid pesado (AG Grid etc.)** — nosso RowGrid
  + react-virtual cobre o caso com 2 KB; frameworks trariam bundle e
  identidade visual alheia.
- **Threads/JSI custom no device** — ganho marginal sobre fatiamento com
  yields, e custaria a promessa plug-and-play (nada de código nativo).

## 5. Resumo executivo

Não há lib que resolva isso; há arquitetura. O plano transforma o
inspector de "copia dados para mostrar" em "janela sobre dados que não se
movem": previews truncados na origem, paginação por cursor, streaming
chunked cancelável para acesso integral, virtualização e workers na UI,
busca e export executados onde o dado mora. Os orçamentos da §1 são o
contrato objetivo de "100% leve" — verificados no CI, inclusive o guard de
fio e a fatia de thread. O "100% dos dados" é garantido pela arquitetura do
stream (nada truncado no caminho), e o checksum FNV-1a acumulado, comparado
no Studio, protege contra corrupção acidental de transporte.
