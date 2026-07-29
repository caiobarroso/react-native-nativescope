# Testar o NativeScope localmente (sem publicar)

Como rodar o build local do `react-native-nativescope` dentro de um app real
(ex.: app-proline) antes de publicar no npm.

Usamos **yalc** (não `npm link`/`file:`): o Metro é hostil a symlink, e o yalc
**copia** o pacote pro app — igual a um publish local — então o Metro vê
arquivos reais e a iteração é rápida.

Pré-requisito (uma vez):

```bash
npm i -g yalc
```

---

## No repo do NativeScope

```bash
# 1. build do artefato real (o mesmo que o npm publish geraria)
pnpm --filter react-native-nativescope build

# 2. publica no store local do yalc
cd apps/cli && yalc publish
```

---

## No app que você está testando

```bash
# 1. puxa a cópia local (sobrescreve o react-native-nativescope publicado)
yalc add react-native-nativescope

# 2. reinstala as deps (use o gerenciador do app)
pnpm install     # ou npm / yarn / bun
```

### Obrigatório — ligar network sem derrubar storage

O config é a **fonte da verdade**: com um config presente, cada módulo só liga
se declarado. Declare os dois, senão o storage some sem erro:

```ts
// nativescope.config.ts — preserve o que já existe
export default {
  modules: {
    storage: true,   // OBRIGATÓRIO, senão o storage é desligado
    network: true,
  },
};
```

> Sem nenhum config, o default legado liga só storage (retrocompat). Network é
> opt-in — precisa do config acima pra aparecer.

### Obrigatório — subir o Metro com cache zerado

O boot do network é injetado por um babel-transformer. Cache velho = boot nunca
injetado = network some silenciosamente. Sempre reinicie com reset:

```bash
npx expo start -c                    # Expo
# ou
npx react-native start --reset-cache # bare
```

---

## Iterar (depois de mexer no módulo)

No repo:

```bash
pnpm --filter react-native-nativescope build && (cd apps/cli && yalc push)
```

`yalc push` re-publica e atualiza o app automaticamente. Reinicie o Metro com
`-c` de novo.

---

## Limpar ao terminar

No app testado:

```bash
yalc remove react-native-nativescope && pnpm install
```

Restaura o `react-native-nativescope` publicado.

---

## Antes de publicar de verdade — teste de fidelidade com tarball

O yalc é pra iterar. Antes do `npm publish`, faça **um** teste com o tarball
puro — é exatamente o que vai pro npm, e pega qualquer arquivo que tenha ficado
fora de `files: [app, dist, metro]`:

```bash
# no repo
cd apps/cli && npm pack        # gera react-native-nativescope-<versão>.tgz

# no app testado
pnpm add -D /caminho/absoluto/para/react-native-nativescope-<versão>.tgz
```

---

## Se algo não aparecer

- **Storage sumiu:** faltou `storage: true` no bloco `modules`.
- **Network não aparece:** faltou `network: true`, ou o Metro subiu sem `-c`.
- **SVG/assets quebraram:** o app tem `transformer.babelTransformerPath` próprio
  — confirme que o `withNativeScope` está compondo com ele, não sobrescrevendo.
