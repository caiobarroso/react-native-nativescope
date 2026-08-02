"use strict";

/**
 * Config plug-and-play do NativeScope (resolvida pelo Metro como
 * "__rnsi_config__"). Só existe em DEV — o resolver nunca a injeta no bundle
 * de produção.
 *
 * indicator: true liga o toast "Storage updated" dentro do app — o badge
 * coral que confirma, na tela do telefone, que uma mudança feita no Studio
 * chegou. É o par visual perfeito para a demo: editar no navegador e ver o
 * app piscar o aviso.
 *
 * A ponte com React Query já é instalada no App.js
 * (installNativeScopeDevtools), então aqui só ligamos o indicador.
 *
 * network: true instala o inspetor de rede no earlyBoot (patch de XHR, antes
 * do app). A aba "Request" no App.js faz HTTP e GraphQL reais para exercitá-lo.
 *
 * logs: true instrumenta console.* e as falhas globais, também no earlyBoot —
 * é o que permite capturar o que o app loga durante o próprio boot.
 */
module.exports = {
  modules: {
    storage: {
      indicator: true,
      reactQuery: true,
    },
    network: true,
    logs: true,
  },
};
