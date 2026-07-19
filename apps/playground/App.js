import { useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Playground da Fase 0/1: exercita AsyncStorage de verdade num simulador.
 * O objetivo é o GIF — tocar "Logout" e ver as chaves limparem ao vivo na
 * Atividade do Studio.
 */
export default function App() {
  const [status, setStatus] = useState("pronto");

  async function login() {
    await AsyncStorage.multiSet([
      ["auth.token", `tok-${Date.now()}`],
      ["user.profile", JSON.stringify({ name: "Caio", premium: false })],
      ["session.startedAt", new Date().toISOString()],
    ]);
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
