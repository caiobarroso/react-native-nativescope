# ADR-0001 — Coalescing de eventos de mudança no runtime

Status: aceito · Data: 2026-07-19 · Contexto: plano de grandes volumes §A4

## Problema

Um app write-heavy pode escrever milhares de vezes por segundo na mesma
chave/tabela. O runtime encaminhava CADA mudança como um evento WS
individual — e o mesmo fluxo alimenta o bus do `/app`
(`react-native-storage-inspector/app`). Sob rajada, isso afoga o transporte,
força o Studio a processar milhares de mensagens e re-renderizações, e faz
o inspector competir com o app pela JS thread.

## Decisão

Eventos `key-value.changed` e `database.changed` passam por um coalescer
**leading + trailing** no bootstrap do runtime (janela de 100 ms, teto de
500 chaves pendentes → flush imediato):

- a **primeira** mudança de uma chave/tabela sai imediatamente — o realtime
  perceptível não muda;
- mudanças **seguintes** dentro da janela viram UM evento com o estado mais
  recente e `coalescedCount` (novo campo opcional no protocolo) dizendo
  quantas mudanças ele representa.

O bus do `/app` recebe o mesmo fluxo coalescido — semântica única.

## Mudança de semântica (o motivo deste ADR)

Antes: "um evento = uma mudança". Depois: "um evento = *pelo menos* uma
mudança nesta chave desde o último evento; a quantidade exata está em
`coalescedCount`". Consumidores que CONTAVAM eventos para inferir quantidade
de escritas devem somar `coalescedCount ?? 1`. Consumidores que só reagem a
"algo mudou aqui" (o caso dos hooks do `/app`, que relêem o storage) não
percebem diferença — apenas re-renderizam menos.

## Consequências

- Tráfego e re-render sob rajada: O(chaves distintas × 10/s) em vez de
  O(escritas). Memória do coalescer: O(chaves distintas na janela), ≤ 500.
- A timeline do Studio mostra "×N" no evento fundido — não subconta.
- O `entry` do evento fundido é o estado MAIS RECENTE da chave; estados
  intermediários da rajada não são observáveis via eventos (por desenho —
  quem precisar de cada estado intermediário precisa de outra ferramenta).
- Latência máxima adicionada a uma mudança não-primeira: ~2× a janela
  (200 ms). A primeira mudança segue instantânea.
