const { getDefaultConfig } = require("expo/metro-config");
const { withNativeScope } = require("react-native-nativescope/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeScope(config, { projectRoot: __dirname });
