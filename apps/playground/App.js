import { useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MMKV } from "react-native-mmkv";

/**
 * Playground das Fases 0–2: AsyncStorage + MMKV de verdade num simulador.
 * O objetivo é o GIF — tocar "Logout" e ver as chaves limparem ao vivo na
 * Atividade do Studio.
 *
 * As instâncias MMKV abaixo são criadas em ESCOPO DE MÓDULO de propósito:
 * é o caso que quebra qualquer discovery em runtime e que o shim do Metro
 * pega sem esforço. A encriptada prova que ler através da instância
 * funciona mesmo com chave.
 */
const settings = new MMKV({ id: "settings" });
const secure = new MMKV({ id: "secure", encryptionKey: "playground-key" });

export default function App() {
  const [status, setStatus] = useState("pronto");

  async function login() {
    await AsyncStorage.multiSet([
      ["auth.token", `tok-${Date.now()}`],
      ["user.profile", JSON.stringify({ name: "Caio", premium: false })],
      ["session.startedAt", new Date().toISOString()],
    ]);
    settings.set("app.lastLogin", new Date().toISOString());
    settings.set("app.launchCount", (settings.getNumber("app.launchCount") ?? 0) + 1);
    secure.set("secure.pin", "1234");
    setStatus("logado");
  }

  async function addToQueue() {
    const raw = (await AsyncStorage.getItem("sync.queue")) ?? "[]";
    const queue = JSON.parse(raw);
    queue.push({ id: Date.now(), kind: "visit" });
    await AsyncStorage.setItem("sync.queue", JSON.stringify(queue));
    setStatus(`fila: ${queue.length}`);
  }

  async function logout() {
    await AsyncStorage.multiRemove([
      "auth.token",
      "user.profile",
      "session.startedAt",
      "sync.queue",
    ]);
    settings.delete("app.lastLogin");
    secure.delete("secure.pin");
    setStatus("deslogado");
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Storage Inspector — Playground</Text>
      <Text style={styles.status}>{status}</Text>
      <View style={styles.buttons}>
        <Button title="Login (grava 3 chaves)" onPress={login} />
        <Button title="Adicionar à fila de sync" onPress={addToQueue} />
        <Button title="Logout (limpa tudo)" onPress={logout} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 18, fontWeight: "600", textAlign: "center" },
  status: { textAlign: "center", color: "#6b6862" },
  buttons: { gap: 12 },
});
