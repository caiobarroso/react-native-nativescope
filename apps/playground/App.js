import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MMKV } from "react-native-mmkv";
import * as SQLite from "expo-sqlite";
import {
  installNativeScopeDevtools,
  useNativeScopeSignal,
} from "react-native-nativescope/app";

if (typeof __DEV__ === "undefined" || __DEV__) {
  installNativeScopeDevtools();
}

const settings = new MMKV({ id: "settings" });
const secure = new MMKV({ id: "secure", encryptionKey: "playground-key" });
const cache = new MMKV({ id: "cache" });
const flags = new MMKV({ id: "feature-flags" });

const DB_NAME = "rnsi-playground.db";
const KNOWN_ASYNC_PREFIXES = [
  "auth.",
  "user.",
  "session.",
  "sync.",
  "prefs.",
  "draft.",
  "rnsi.bulk.",
  "rnsi.edge.",
];

const names = [
  "Ana",
  "Bruno",
  "Caio",
  "Duda",
  "Elisa",
  "Fernanda",
  "Gabi",
  "Hugo",
  "Igor",
  "Julia",
];
const tiers = ["free", "starter", "pro", "enterprise"];
const eventKinds = ["login", "purchase", "sync", "logout", "error", "background-refresh"];

function nowIso() {
  return new Date().toISOString();
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function compactError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sqlValue(value) {
  if (value === undefined) return null;
  return value;
}

export default function App() {
  const [status, setStatus] = useState("Inicializando playground");
  const [db, setDb] = useState(null);
  const [snapshot, setSnapshot] = useState({
    asyncKeys: 0,
    settingsKeys: 0,
    secureKeys: 0,
    cacheKeys: 0,
    flagsKeys: 0,
    customers: 0,
    orders: 0,
    events: 0,
  });
  const [customProvider, setCustomProvider] = useState("async");
  const [customKey, setCustomKey] = useState("draft.note");
  const [customValue, setCustomValue] = useState("valor editavel");
  const [sqlRows, setSqlRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const studioSignal = useNativeScopeSignal({ source: "studio" });

  const ready = Boolean(db);
  const databaseSummary = useMemo(
    () => `${snapshot.customers} clientes / ${snapshot.orders} pedidos / ${snapshot.events} eventos`,
    [snapshot],
  );

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const opened = await SQLite.openDatabaseAsync(DB_NAME);
        if (cancelled) return;
        await opened.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            tier TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            metadata TEXT,
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            total_cents INTEGER NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id)
          );
          CREATE TABLE IF NOT EXISTS app_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            payload TEXT,
            created_at TEXT NOT NULL
          );
        `);
        setDb(opened);
        setStatus("Playground pronto");
        await refreshSnapshot(opened);
      } catch (error) {
        setStatus(`SQLite falhou: ${compactError(error)}`);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (studioSignal === 0) return;
    void refreshSnapshot(db);
    void refreshSqlRows();
    setStatus("Alteracao do Studio refletida no app");
  }, [studioSignal, db]);

  async function run(label, task) {
    setBusy(true);
    try {
      await task();
      setStatus(label);
      await refreshSnapshot(db);
    } catch (error) {
      const message = compactError(error);
      setStatus(`Erro: ${message}`);
      Alert.alert("Playground", message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshSnapshot(database = db) {
    const asyncKeys = await AsyncStorage.getAllKeys();
    const counts = {
      asyncKeys: asyncKeys.length,
      settingsKeys: settings.getAllKeys().length,
      secureKeys: secure.getAllKeys().length,
      cacheKeys: cache.getAllKeys().length,
      flagsKeys: flags.getAllKeys().length,
      customers: 0,
      orders: 0,
      events: 0,
    };
    if (database) {
      const [customersCount] = await database.getAllAsync("SELECT COUNT(*) AS n FROM customers");
      const [ordersCount] = await database.getAllAsync("SELECT COUNT(*) AS n FROM orders");
      const [eventsCount] = await database.getAllAsync("SELECT COUNT(*) AS n FROM app_events");
      counts.customers = Number(customersCount?.n ?? 0);
      counts.orders = Number(ordersCount?.n ?? 0);
      counts.events = Number(eventsCount?.n ?? 0);
    }
    setSnapshot(counts);
  }

  async function seedSession() {
    const queue = Array.from({ length: 4 }, (_, index) => ({
      id: Date.now() + index,
      kind: randomFrom(eventKinds),
      attempts: index,
    }));
    await AsyncStorage.multiSet([
      ["auth.token", `tok-${Date.now()}`],
      ["auth.refreshToken", `refresh-${Date.now()}`],
      ["user.profile", JSON.stringify({ id: 42, name: "Caio", premium: true })],
      ["session.startedAt", nowIso()],
      ["prefs.theme", "system"],
      ["prefs.notifications", JSON.stringify({ push: true, email: false })],
      ["sync.queue", JSON.stringify(queue)],
      ["rnsi.edge.emptyString", ""],
      ["rnsi.edge.nullLiteral", "null"],
    ]);
  }

  async function addBulkAsync() {
    const entries = Array.from({ length: 30 }, (_, index) => [
      `rnsi.bulk.${String(index + 1).padStart(2, "0")}`,
      JSON.stringify({
        index: index + 1,
        score: randomInt(1, 1000),
        active: index % 2 === 0,
        updatedAt: nowIso(),
      }),
    ]);
    await AsyncStorage.multiSet(entries);
  }

  async function pushQueueItem() {
    const raw = (await AsyncStorage.getItem("sync.queue")) ?? "[]";
    const queue = JSON.parse(raw);
    queue.push({ id: Date.now(), kind: randomFrom(eventKinds), attempts: 0 });
    await AsyncStorage.setItem("sync.queue", JSON.stringify(queue));
  }

  async function popQueueItem() {
    const raw = (await AsyncStorage.getItem("sync.queue")) ?? "[]";
    const queue = JSON.parse(raw);
    queue.shift();
    await AsyncStorage.setItem("sync.queue", JSON.stringify(queue));
  }

  async function clearAsyncPlayground() {
    const keys = await AsyncStorage.getAllKeys();
    const scoped = keys.filter((key) => KNOWN_ASYNC_PREFIXES.some((prefix) => key.startsWith(prefix)));
    await AsyncStorage.multiRemove(scoped);
  }

  function seedMmkv() {
    settings.set("app.lastLogin", nowIso());
    settings.set("app.launchCount", (settings.getNumber("app.launchCount") ?? 0) + 1);
    settings.set("ui.scale", randomFrom(["compact", "comfortable", "spacious"]));
    settings.set("onboarding.done", true);
    secure.set("secure.pin", String(randomInt(1000, 9999)));
    secure.set("secure.accessToken", `mmkv-secure-${Date.now()}`);
    cache.set("cache.feed", JSON.stringify(makeFeed(8)));
    cache.set("cache.lastFetchMs", Date.now());
    flags.set("flag.paywall", Math.random() > 0.5);
    flags.set("flag.checkoutVariant", randomFrom(["control", "one-click", "bundled"]));
  }

  function mutateMmkv() {
    settings.set("app.launchCount", (settings.getNumber("app.launchCount") ?? 0) + 1);
    settings.set("app.lastSeenScreen", randomFrom(["Home", "Cart", "Profile", "Debug"]));
    cache.set(`cache.item.${Date.now()}`, JSON.stringify({ ttl: randomInt(30, 600), at: nowIso() }));
    flags.set("flag.paywall", !flags.getBoolean("flag.paywall"));
  }

  function deleteMmkvSample() {
    settings.delete("app.lastSeenScreen");
    secure.delete("secure.pin");
    const cacheKeys = cache.getAllKeys().filter((key) => key.startsWith("cache.item."));
    if (cacheKeys[0]) cache.delete(cacheKeys[0]);
  }

  function clearMmkv() {
    for (const storage of [settings, secure, cache, flags]) {
      for (const key of storage.getAllKeys()) storage.delete(key);
    }
  }

  function makeFeed(size) {
    return Array.from({ length: size }, (_, index) => ({
      id: `feed-${Date.now()}-${index}`,
      title: `Item ${index + 1}`,
      unread: index % 3 === 0,
    }));
  }

  async function seedDatabase(size = 12) {
    if (!db) return;
    for (let index = 0; index < size; index += 1) {
      const name = randomFrom(names);
      const createdAt = nowIso();
      const result = await db.runAsync(
        `INSERT OR IGNORE INTO customers (name, email, tier, is_active, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `${name} ${randomInt(100, 999)}`,
          `user.${Date.now()}.${index}@example.test`,
          randomFrom(tiers),
          index % 5 === 0 ? 0 : 1,
          JSON.stringify({ source: "seed", cohort: randomFrom(["A", "B", "C"]) }),
          createdAt,
        ],
      );
      const customerId = result.lastInsertRowId;
      await db.runAsync(
        `INSERT INTO orders (customer_id, total_cents, status, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [customerId, randomInt(1500, 95000), randomFrom(["draft", "paid", "refunded"]), "seed", createdAt],
      );
      await db.runAsync(
        "INSERT INTO app_events (kind, payload, created_at) VALUES (?, ?, ?)",
        [randomFrom(eventKinds), JSON.stringify({ customerId, source: "seed" }), createdAt],
      );
    }
    await refreshSqlRows();
  }

  async function addDatabaseRow() {
    if (!db) return;
    const result = await db.runAsync(
      `INSERT INTO customers (name, email, tier, is_active, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `${randomFrom(names)} ${randomInt(100, 999)}`,
        `manual.${Date.now()}@example.test`,
        randomFrom(tiers),
        1,
        JSON.stringify({ source: "manual-add", edited: false }),
        nowIso(),
      ],
    );
    await db.runAsync(
      `INSERT INTO app_events (kind, payload, created_at) VALUES (?, ?, ?)`,
      ["customer.created", JSON.stringify({ customerId: result.lastInsertRowId }), nowIso()],
    );
    await refreshSqlRows();
  }

  async function updateDatabaseRows() {
    if (!db) return;
    await db.runAsync(
      `UPDATE customers
       SET tier = ?, metadata = ?, is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
       WHERE id IN (SELECT id FROM customers ORDER BY id DESC LIMIT 3)`,
      [randomFrom(tiers), JSON.stringify({ source: "bulk-update", updatedAt: nowIso() })],
    );
    await db.runAsync(
      "INSERT INTO app_events (kind, payload, created_at) VALUES (?, ?, ?)",
      ["customers.bulk_update", JSON.stringify({ rows: 3 }), nowIso()],
    );
    await refreshSqlRows();
  }

  async function deleteDatabaseRows() {
    if (!db) return;
    await db.runAsync(
      "DELETE FROM orders WHERE id IN (SELECT id FROM orders ORDER BY id ASC LIMIT 2)",
    );
    await db.runAsync(
      "DELETE FROM customers WHERE id IN (SELECT id FROM customers ORDER BY id ASC LIMIT 2)",
    );
    await db.runAsync(
      "INSERT INTO app_events (kind, payload, created_at) VALUES (?, ?, ?)",
      ["cleanup.deleted_rows", JSON.stringify({ customers: 2, orders: 2 }), nowIso()],
    );
    await refreshSqlRows();
  }

  async function resetDatabase() {
    if (!db) return;
    await db.execAsync(`
      DELETE FROM orders;
      DELETE FROM customers;
      DELETE FROM app_events;
      DELETE FROM sqlite_sequence WHERE name IN ('orders', 'customers', 'app_events');
    `);
    setSqlRows([]);
  }

  async function refreshSqlRows() {
    if (!db) return;
    const rows = await db.getAllAsync(
      `SELECT
        c.id,
        c.name,
        c.tier,
        c.is_active AS active,
        COUNT(o.id) AS orders,
        COALESCE(SUM(o.total_cents), 0) AS total_cents
       FROM customers c
       LEFT JOIN orders o ON o.customer_id = c.id
       GROUP BY c.id
       ORDER BY c.id DESC
       LIMIT 8`,
    );
    setSqlRows(rows);
  }

  async function applyCustomValue() {
    if (customProvider === "async") {
      await AsyncStorage.setItem(customKey, customValue);
      return;
    }
    const target =
      customProvider === "settings"
        ? settings
        : customProvider === "secure"
          ? secure
          : customProvider === "flags"
            ? flags
            : cache;
    target.set(customKey, customValue);
  }

  async function deleteCustomValue() {
    if (customProvider === "async") {
      await AsyncStorage.removeItem(customKey);
      return;
    }
    const target =
      customProvider === "settings"
        ? settings
        : customProvider === "secure"
          ? secure
          : customProvider === "flags"
            ? flags
            : cache;
    target.delete(customKey);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>NativeScope</Text>
            <Text style={styles.title}>Playground completo</Text>
          </View>
          <StatusBadge busy={busy} ready={ready} />
        </View>

        <Text style={styles.status}>{status}</Text>

        <View style={styles.metrics}>
          <Metric label="AsyncStorage" value={`${snapshot.asyncKeys} chaves`} />
          <Metric label="MMKV" value={`${snapshot.settingsKeys + snapshot.secureKeys + snapshot.cacheKeys + snapshot.flagsKeys} chaves`} />
          <Metric label="SQLite" value={databaseSummary} />
        </View>

        <Section title="AsyncStorage" caption="Listagens, filas, edicoes, massa de chaves e remocoes.">
          <ActionGrid>
            <ActionButton title="Seed sessao" onPress={() => run("AsyncStorage: sessao criada", seedSession)} />
            <ActionButton title="Gerar 30 chaves" onPress={() => run("AsyncStorage: lote criado", addBulkAsync)} />
            <ActionButton title="Push fila" onPress={() => run("AsyncStorage: item entrou na fila", pushQueueItem)} />
            <ActionButton title="Pop fila" onPress={() => run("AsyncStorage: item removido da fila", popQueueItem)} />
            <ActionButton title="Limpar escopo" tone="danger" onPress={() => run("AsyncStorage: escopo limpo", clearAsyncPlayground)} />
          </ActionGrid>
        </Section>

        <Section title="MMKV" caption="Quatro instancias: settings, secure criptografada, cache e feature-flags.">
          <ActionGrid>
            <ActionButton title="Seed MMKV" onPress={() => run("MMKV: dados criados", () => seedMmkv())} />
            <ActionButton title="Mutar valores" onPress={() => run("MMKV: valores alterados", () => mutateMmkv())} />
            <ActionButton title="Deletar amostra" onPress={() => run("MMKV: amostra removida", () => deleteMmkvSample())} />
            <ActionButton title="Limpar MMKV" tone="danger" onPress={() => run("MMKV: instancias limpas", () => clearMmkv())} />
          </ActionGrid>
        </Section>

        <Section title="SQLite" caption="Banco com customers, orders e app_events para testar schema, grid, update, insert, delete e console SQL.">
          <ActionGrid>
            <ActionButton title="Seed 12 linhas" disabled={!ready} onPress={() => run("SQLite: seed inserido", () => seedDatabase(12))} />
            <ActionButton title="Inserir cliente" disabled={!ready} onPress={() => run("SQLite: cliente inserido", addDatabaseRow)} />
            <ActionButton title="Alterar 3 ultimos" disabled={!ready} onPress={() => run("SQLite: linhas alteradas", updateDatabaseRows)} />
            <ActionButton title="Deletar antigos" disabled={!ready} tone="danger" onPress={() => run("SQLite: linhas antigas removidas", deleteDatabaseRows)} />
            <ActionButton title="Reset DB" disabled={!ready} tone="danger" onPress={() => run("SQLite: banco zerado", resetDatabase)} />
            <ActionButton title="Reconsultar" disabled={!ready} onPress={() => run("SQLite: snapshot atualizado", refreshSqlRows)} />
          </ActionGrid>
          <View style={styles.table}>
            {sqlRows.length === 0 ? (
              <Text style={styles.muted}>Sem linhas no snapshot local. Use Seed 12 linhas.</Text>
            ) : (
              sqlRows.map((row) => (
                <View key={row.id} style={styles.row}>
                  <Text style={styles.rowTitle}>#{row.id} {row.name}</Text>
                  <Text style={styles.rowMeta}>
                    {row.tier} · {row.active ? "ativo" : "inativo"} · {row.orders} pedidos · R$ {(Number(row.total_cents) / 100).toFixed(2)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </Section>

        <Section title="Editor rapido" caption="Escreva, altere ou remova uma chave especifica sem sair do app.">
          <View style={styles.segmented}>
            {["async", "settings", "secure", "cache", "flags"].map((provider) => (
              <Pressable
                key={provider}
                onPress={() => setCustomProvider(provider)}
                style={[styles.segment, customProvider === provider && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, customProvider === provider && styles.segmentTextActive]}>
                  {provider}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={customKey}
            onChangeText={setCustomKey}
            placeholder="chave"
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={customValue}
            onChangeText={setCustomValue}
            placeholder="valor"
            multiline
            style={[styles.input, styles.textarea]}
          />
          <ActionGrid>
            <ActionButton title="Salvar valor" onPress={() => run("Editor: valor salvo", applyCustomValue)} />
            <ActionButton title="Deletar chave" tone="danger" onPress={() => run("Editor: chave deletada", deleteCustomValue)} />
            <ActionButton title="Atualizar contadores" onPress={() => run("Snapshot atualizado", () => refreshSnapshot(db))} />
          </ActionGrid>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, caption, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.caption}>{caption}</Text>
      {children}
    </View>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({ busy, ready }) {
  const label = busy ? "rodando" : ready ? "pronto" : "sqlite...";
  return (
    <View style={[styles.badge, busy && styles.badgeBusy]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function ActionGrid({ children }) {
  return <View style={styles.actions}>{children}</View>;
}

function ActionButton({ title, onPress, tone = "default", disabled = false }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        tone === "danger" && styles.actionDanger,
        pressed && !disabled && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Text style={[styles.actionText, tone === "danger" && styles.actionTextDanger]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f5f3ef",
  },
  content: {
    padding: 18,
    gap: 14,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  kicker: {
    color: "#6f6a61",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    color: "#171513",
    fontSize: 28,
    fontWeight: "800",
    marginTop: 2,
  },
  status: {
    backgroundColor: "#24211d",
    borderRadius: 8,
    color: "#fffaf1",
    fontSize: 13,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  badge: {
    backgroundColor: "#d9efe0",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeBusy: {
    backgroundColor: "#f4dfb8",
  },
  badgeText: {
    color: "#14351f",
    fontSize: 12,
    fontWeight: "800",
  },
  metrics: {
    flexDirection: "row",
    gap: 8,
  },
  metric: {
    backgroundColor: "#ffffff",
    borderColor: "#e1ded8",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  metricValue: {
    color: "#171513",
    fontSize: 15,
    fontWeight: "800",
  },
  metricLabel: {
    color: "#756f66",
    fontSize: 11,
    marginTop: 3,
  },
  section: {
    backgroundColor: "#ffffff",
    borderColor: "#ded9d0",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: "#171513",
    fontSize: 18,
    fontWeight: "800",
  },
  caption: {
    color: "#6d665d",
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  action: {
    alignItems: "center",
    backgroundColor: "#ece7df",
    borderColor: "#d8d0c5",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionDanger: {
    backgroundColor: "#fae8e5",
    borderColor: "#efc7c0",
  },
  actionPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionText: {
    color: "#29241f",
    fontSize: 13,
    fontWeight: "800",
  },
  actionTextDanger: {
    color: "#942316",
  },
  table: {
    borderColor: "#e6e1da",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    borderBottomColor: "#eee9e2",
    borderBottomWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowTitle: {
    color: "#1e1b18",
    fontSize: 13,
    fontWeight: "800",
  },
  rowMeta: {
    color: "#6b645b",
    fontSize: 12,
    marginTop: 2,
  },
  muted: {
    color: "#777168",
    fontSize: 13,
    padding: 10,
  },
  segmented: {
    backgroundColor: "#eee9e1",
    borderRadius: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: 6,
  },
  segment: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  segmentActive: {
    backgroundColor: "#22201d",
  },
  segmentText: {
    color: "#5e574f",
    fontSize: 12,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: "#fffaf1",
  },
  input: {
    backgroundColor: "#fbfaf7",
    borderColor: "#d8d1c7",
    borderRadius: 8,
    borderWidth: 1,
    color: "#171513",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textarea: {
    minHeight: 82,
    textAlignVertical: "top",
  },
});
