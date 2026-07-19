// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config");
const { withStorageInspector } = require("react-native-storage-inspector/metro");

// Escape hatch explícito enquanto a CLI não sobe o Metro sozinha (Fase 1).
// O fluxo final não exige esta linha.
module.exports = withStorageInspector(getDefaultConfig(__dirname), {
  projectRoot: __dirname,
});
