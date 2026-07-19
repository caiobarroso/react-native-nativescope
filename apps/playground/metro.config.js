// Config Expo padrão, de propósito: a CLI embrulha sozinha no primeiro
// `rn-storage-inspector` (auto-config da Fase 1). Nenhuma linha manual.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
