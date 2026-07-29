"use strict";

/**
 * Bootstrap compartilhado dos shims (marcador: __RNSI_SHIM__).
 *
 * Um runtime por app, criado sob demanda no primeiro shim que carregar.
 * `runtime-bundle.js` é o @rnsi/runtime REAL, bundlado no build da CLI —
 * o mesmo código coberto pelos contract tests.
 */

const session = require("__rnsi_session__");
const configModule = require("__rnsi_config__");
const rnsi = require("./runtime-bundle.js");
const { MODULES, computeEnabledModules } = require("../modules.cjs");

let runtime = null;
let configInstalled = false;
let indicatorInstalled = false;
let configLoaded = false;
let loadedConfig = null;
let enabledModules = null;

function detectPlatform() {
  try {
    return require("react-native").Platform.OS;
  } catch {
    return "unknown";
  }
}

// Id estável por-launch deste device. NÃO persiste de propósito: persistir
// sujaria o storage inspecionado. O heartbeat do servidor limpa a entrada
// antiga após um full-reload, e o desktop reata a navegação por (name,
// platform). Dois emuladores da mesma plataforma ganham ids distintos → não
// brigam por um slot.
let deviceId = null;
function getDeviceId() {
  if (deviceId === null) {
    deviceId = "d-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  return deviceId;
}

function deviceLabel(platform) {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  if (platform === "web") return "Web";
  return platform;
}

function loadInspectorConfig() {
  const config = configModule && (configModule.default || configModule);
  return typeof config === "function" ? config() : config;
}

function normalizeIndicatorOptions(value) {
  if (!value) return null;
  return value === true ? {} : value;
}

function installIndicator(value) {
  const options = normalizeIndicatorOptions(value);
  if (!options || indicatorInstalled) return;
  indicatorInstalled = true;

  try {
    const React = require("react");
    const ReactNative = require("react-native");
    const { Animated, AppRegistry, Platform, Pressable, StyleSheet, Text, View } = ReactNative;
    if (!AppRegistry || typeof AppRegistry.registerComponent !== "function") return;

    const originalRegisterComponent = AppRegistry.registerComponent.bind(AppRegistry);
    const autoHideMs =
      typeof options.autoHideMs === "number" && options.autoHideMs > 0
        ? options.autoHideMs
        : 1600;
    const bottomOffset =
      typeof options.bottomOffset === "number"
        ? options.bottomOffset
        : Platform?.OS === "android"
          ? 72
          : 22;

    const palette = {
      accent: "#d97757",
      accentWash: "#f5e6df",
      border: "#d6d2c6",
      shadow: "#000000",
      surface: "#faf9f5",
      text: "#1f1e1d",
      textMuted: "#6b6862",
      textSubtle: "#9a968c",
    };

    const styles = StyleSheet.create({
      root: {
        flex: 1,
      },
      host: {
        bottom: bottomOffset,
        left: 0,
        position: "absolute",
        right: 0,
      },
      badge: {
        alignItems: "center",
        alignSelf: "center",
        backgroundColor: palette.surface,
        borderColor: palette.border,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 4,
        flexDirection: "row",
        gap: 8,
        maxWidth: "88%",
        minHeight: 42,
        paddingHorizontal: 14,
        shadowColor: palette.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      dot: {
        backgroundColor: palette.accent,
        borderRadius: 6,
        height: 10,
        width: 10,
      },
      title: {
        color: palette.text,
        fontSize: 13,
        fontWeight: "700",
      },
      close: {
        marginLeft: 4,
        paddingHorizontal: 2,
        paddingVertical: 2,
      },
      closeText: {
        color: palette.textSubtle,
        fontSize: 15,
        lineHeight: 16,
      },
    });

    function NativeScopeIndicator() {
      const [visible, setVisible] = React.useState(false);
      const hiddenRef = React.useRef(false);
      const timeoutRef = React.useRef(null);
      const opacity = React.useRef(new Animated.Value(0)).current;
      const translateY = React.useRef(new Animated.Value(8)).current;

      const hide = React.useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        Animated.parallel([
          Animated.timing(opacity, {
            duration: 140,
            toValue: 0,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            duration: 140,
            toValue: 8,
            useNativeDriver: true,
          }),
        ]).start(() => setVisible(false));
      }, [opacity, translateY]);

      React.useEffect(() => {
        return rnsi.subscribeAppDevtoolsChange?.(
          () => {
            if (hiddenRef.current) return;
            setVisible(true);
            opacity.stopAnimation();
            translateY.stopAnimation();
            Animated.parallel([
              Animated.timing(opacity, {
                duration: 180,
                toValue: 1,
                useNativeDriver: true,
              }),
              Animated.spring(translateY, {
                damping: 18,
                mass: 0.8,
                stiffness: 180,
                toValue: 0,
                useNativeDriver: true,
              }),
            ]).start();
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(hide, autoHideMs);
          },
          { source: "studio", ...(options.eventFilter || {}) },
        );
      }, [hide, opacity, translateY]);

      React.useEffect(() => {
        return () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
      }, []);

      if (!visible) return null;

      return React.createElement(
        View,
        { pointerEvents: "box-none", style: styles.host },
        React.createElement(
          Animated.View,
          {
            pointerEvents: "auto",
            style: [
              styles.badge,
              {
                opacity,
                transform: [{ translateY }],
              },
            ],
          },
          React.createElement(View, { style: styles.dot }),
          React.createElement(Text, { numberOfLines: 1, style: styles.title }, "Storage updated"),
          React.createElement(
            Pressable,
            {
              accessibilityLabel: "Hide NativeScope indicator",
              onPress: () => {
                hiddenRef.current = true;
                hide();
              },
              style: styles.close,
            },
            React.createElement(Text, { style: styles.closeText }, "x"),
          ),
        ),
      );
    }

    AppRegistry.registerComponent = (appKey, getComponent, ...rest) =>
      originalRegisterComponent(
        appKey,
        () => {
          const Component = getComponent();
          if (!Component || Component.__RNSI_INDICATOR_WRAPPED__) return Component;

          function NativeScopeRoot(props) {
            return React.createElement(
              View,
              { style: styles.root },
              React.createElement(Component, props),
              React.createElement(NativeScopeIndicator),
            );
          }

          NativeScopeRoot.displayName = `NativeScopeRoot(${
            Component.displayName || Component.name || "App"
          })`;
          NativeScopeRoot.__RNSI_INDICATOR_WRAPPED__ = true;
          return NativeScopeRoot;
        },
        ...rest,
      );
  } catch (error) {
    console.warn("[nativescope] failed to install the visual indicator:", error);
  }
}

/**
 * Carga leve do config (sem efeitos colaterais): resolve o objeto e computa os
 * módulos habilitados. Separada da instalação do indicator de propósito — o
 * gating (isModuleEnabled/bootModules) precisa do config bem cedo (no boot,
 * antes do app), mas NÃO pode instalar o indicator àquela altura. O caminho de
 * storage continua chamando installConfigOnce (completo) via getRuntime, com o
 * mesmo timing de sempre.
 */
function ensureConfigLoaded() {
  if (configLoaded) return loadedConfig;
  configLoaded = true;
  try {
    loadedConfig = loadInspectorConfig();
  } catch (error) {
    console.warn("[nativescope] failed to load nativescope.config:", error);
    loadedConfig = null;
  }
  enabledModules = computeEnabledModules(loadedConfig).enabled;
  return loadedConfig;
}

/**
 * Um módulo está ligado? Config presente é a fonte da verdade (opt-in); sem
 * config, o default legado liga só storage (retrocompat). Ver modules.cjs.
 */
function isModuleEnabled(key) {
  ensureConfigLoaded();
  return Boolean(enabledModules && enabledModules[key]);
}

function installConfigOnce() {
  if (configInstalled) return loadedConfig;
  configInstalled = true;
  ensureConfigLoaded();
  try {
    rnsi.installAppDevtoolsConfig?.(loadedConfig);
    installIndicator(loadedConfig?.modules?.storage?.indicator);
  } catch (error) {
    console.warn("[nativescope] failed to install nativescope config:", error);
  }
  return loadedConfig;
}

/**
 * Installers dos módulos com earlyBoot (que precisam subir antes do app). O
 * storage NÃO entra aqui — ele se auto-instala nos próprios shims quando a lib
 * é importada.
 *
 * O runtime já expõe sendModuleEvent/onModuleCommand (envelope L3) — o módulo
 * multiplexa sobre a MESMA conexão do storage, sem tocar no schema de storage.
 */
const MODULE_INSTALLERS = {
  network(runtime, config) {
    rnsi.installNetworkModule(runtime, config && config.modules && config.modules.network);
  },
};

/**
 * Sobe o runtime e instala os módulos com earlyBoot que estiverem ligados no
 * config. Chamado por shims/_boot.js, que roda antes do app (via InitializeCore).
 * No-op para projetos storage-only: nenhum módulo earlyBoot ligado.
 */
function bootModules() {
  ensureConfigLoaded();
  try {
    for (const module of MODULES) {
      if (!module.earlyBoot) continue;
      if (!isModuleEnabled(module.key)) continue;
      const installer = MODULE_INSTALLERS[module.key];
      if (typeof installer !== "function") continue;
      const rt = getRuntime();
      if (!rt) return; // sem sessão da CLI (no-session): tudo vira no-op
      try {
        installer(rt, loadedConfig);
      } catch (error) {
        console.warn(`[nativescope] module "${module.key}" failed to install:`, error);
      }
    }
  } catch (error) {
    console.warn("[nativescope] bootModules failed:", error);
  }
}

/**
 * Host do serviço da CLI. Loopback por padrão — cobre iOS Simulator (compartilha
 * o loopback do Mac) e Android (a CLI aplica `adb reverse`). No modo LAN (opt-in
 * --lan, iPhone físico), reusa o host de onde o bundle veio: o `scriptURL` do
 * Metro já aponta para o IP do Mac na Wi-Fi.
 */
/**
 * URL do dev server (Metro). `getDevServer` é o caminho interno do RN usado
 * pelo próprio reload — funciona na Nova Arquitetura/bridgeless, onde o
 * `NativeModules.SourceCode.scriptURL` legado vem `undefined`. Fallbacks para
 * arquiteturas antigas.
 */
function readDevServerUrl() {
  try {
    const mod = require("react-native/Libraries/Core/Devtools/getDevServer");
    const getDevServer = mod && (mod.default || mod);
    const info = typeof getDevServer === "function" ? getDevServer() : null;
    if (info && info.url) return info.url;
  } catch {
    /* segue para os fallbacks */
  }
  try {
    const SourceCode = require("react-native").NativeModules?.SourceCode;
    const scriptURL =
      SourceCode?.scriptURL ?? (SourceCode?.getConstants ? SourceCode.getConstants().scriptURL : null);
    if (scriptURL) return scriptURL;
  } catch {
    /* sem SourceCode — cai no loopback */
  }
  return null;
}

function resolveInspectorHost() {
  if (!session || !session.lan) return "127.0.0.1";
  const devUrl = readDevServerUrl();
  const host = /^[a-z][a-z0-9+.-]*:\/\/([^/:]+)/i.exec(devUrl || "")?.[1];
  if (host && host !== "localhost" && host !== "127.0.0.1") return host;
  return "127.0.0.1";
}

/** null quando não há sessão da CLI — os shims viram no-op. */
function getRuntime() {
  if (!session || typeof session.port !== "number" || typeof session.token !== "string") {
    return null;
  }
  if (!runtime) {
    const platform = detectPlatform();
    const config = installConfigOnce();
    runtime = rnsi.startRuntime({
      url: `ws://${resolveInspectorHost()}:${session.port}`,
      sessionToken: session.token,
      client: {
        name: "react-native-app",
        platform,
        deviceId: getDeviceId(),
        label: deviceLabel(platform),
        features: {
          storageReactQuerySync: Boolean(config?.modules?.storage?.reactQuery),
        },
      },
    });
  }
  return runtime;
}

module.exports = { getRuntime, rnsi, isModuleEnabled, bootModules };
