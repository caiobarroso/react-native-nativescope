"use strict";

// Entregue pelo resolver quando react-native-nativescope/app faz
// require de uma lib de storage que o projeto NÃO tem instalada. Sem isto,
// o Metro falharia o bundle inteiro — mesmo que o hook nunca fosse chamado.
// O consumidor (app/index.cjs) checa null e lança erro amigável só no uso.
module.exports = null;
