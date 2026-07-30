import { useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MMKV } from "react-native-mmkv";
import * as SQLite from "expo-sqlite";
import { open as openOpSqlite } from "@op-engineering/op-sqlite";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { installNativeScopeDevtools } from "react-native-nativescope/app";

/*
 * Playground do NativeScope — feito para a demo.
 *
 * Uma aba por storage, com uma interface que qualquer pessoa entende em três
 * segundos. TODO texto de UI é em inglês de propósito (é o que vai no vídeo).
 * Os comentários seguem em português, como o resto do repo.
 *
 * O ponto alto: tudo passa por React Query. Editar um valor no Studio (no
 * navegador) dispara um evento "source: studio", a ponte abaixo invalida as
 * queries, e o telefone se atualiza sozinho — realtime de verdade, ao vivo.
 */

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 0, retry: false } },
});

// A ponte Studio -> app: qualquer mudança feita no Studio invalida as queries
// e a UI recarrega. Escritas do próprio app invalidam na mão (nas mutations),
// então não há loop.
installNativeScopeDevtools({
  modules: { storage: { reactQuery: { queryClient } } },
});

// -------------------------------------------------------------- storages

const zoo = new MMKV({ id: "zoo" });
const ZOO_KEY = "cages";
const DB_NAME = "playground.db";
// Storage da aba API (network): recebe as escritas que acontecem logo depois
// das respostas, alimentando o painel "Storage impact".
const session = new MMKV({ id: "session" });

let dbPromise = null;
async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          emoji TEXT NOT NULL,
          score INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

// Segundo banco, em OUTRO driver: op-sqlite. Existe para provar que dois
// providers de banco coexistem no Studio, e para exercitar o que a aba do
// expo-sqlite não exercita — BLOB e UPDATE.
const PHOTOS_DB_NAME = "photos.db";
let photosPromise = null;
async function getPhotosDb() {
  if (!photosPromise) {
    photosPromise = (async () => {
      // `open` do op-sqlite é SÍNCRONO (o do expo é async) e não precisa de
      // nenhuma flag para o realtime funcionar — o updateHook é instalado
      // depois, pelo shim.
      const db = openOpSqlite({ name: PHOTOS_DB_NAME });
      await db.execute(`
        CREATE TABLE IF NOT EXISTS photos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL,
          thumb BLOB,
          likes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return photosPromise;
}

/** Bytes determinísticos fazendo papel de miniatura. */
function makeThumb(size) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 17) % 256;
  return bytes;
}

// ------------------------------------------------------------- conteúdo

const CAGE_TEMPLATE = [
  { name: "Jungle", emoji: "🌴" },
  { name: "Ocean", emoji: "🌊" },
  { name: "Farm", emoji: "🚜" },
  { name: "Arctic", emoji: "❄️" },
];
const ANIMALS = [
  "🦁", "🐯", "🐘", "🦒", "🐵", "🐼", "🦊", "🐨", "🐸", "🐧",
  "🐬", "🐙", "🦈", "🐴", "🐮", "🐷", "🐰", "🦓", "🦩", "🦦",
];
const ANIMAL_NAMES = ["Leo", "Milo", "Coco", "Nala", "Zuri", "Bibi", "Rex", "Pip", "Ziggy", "Momo"];
const TRICKS = ["roar", "jump", "spin", "sleep", "dance", "wave"];
const TOY_EMOJIS = ["🧸", "🚗", "🪀", "🎈", "🧩", "🪁", "⚽", "🎨", "🤖", "🦖"];
const PLAYER_NAMES = ["Alex", "Sam", "Kai", "Nova", "Max", "Luna", "Finn", "Ivy", "Theo", "Mia", "Ezra", "Remy"];
const PHOTO_TITLES = ["sunset", "trail", "downtown", "waterfall", "harbor", "rooftop", "market", "dunes"];
const PHOTO_EMOJIS = ["🌅", "🥾", "🏙️", "💦", "⛵", "🌇", "🍉", "🏜️"];

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sample(list, count) {
  return [...list].sort(() => Math.random() - 0.5).slice(0, count);
}

// ================================================================ App

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

const TABS = [
  { key: "zoo", label: "Zoo", icon: "🦁" },
  { key: "toys", label: "Toys", icon: "🧸" },
  { key: "scores", label: "Scores", icon: "🏆" },
  { key: "photos", label: "Photos", icon: "📸" },
  { key: "api", label: "Request", icon: "🌐" },
];

function Shell() {
  const [tab, setTab] = useState("zoo");
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.screen}>
        {tab === "zoo" && <ZooScreen />}
        {tab === "toys" && <ToysScreen />}
        {tab === "scores" && <ScoresScreen />}
        {tab === "photos" && <PhotosScreen />}
        {tab === "api" && <ApiScreen />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{t.icon}</Text>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

// ============================================================ Zoo (MMKV)
// Arrays aninhados num único valor: cages -> animals -> tricks. Ótimo para
// mostrar o inspector abrindo estrutura complexa e um valor grande.

function readZoo() {
  const raw = zoo.getString(ZOO_KEY);
  if (!raw) return CAGE_TEMPLATE.map((c) => ({ ...c, animals: [] }));
  try {
    return JSON.parse(raw);
  } catch {
    return CAGE_TEMPLATE.map((c) => ({ ...c, animals: [] }));
  }
}
function writeZoo(cages) {
  zoo.set(ZOO_KEY, JSON.stringify(cages));
}
function makeAnimal() {
  return {
    emoji: randomFrom(ANIMALS),
    name: randomFrom(ANIMAL_NAMES),
    tricks: sample(TRICKS, randomInt(1, 3)),
  };
}
function addAnimals(count) {
  const cages = readZoo();
  for (let i = 0; i < count; i += 1) {
    cages[randomInt(0, cages.length - 1)].animals.push(makeAnimal());
  }
  writeZoo(cages);
}

function ZooScreen() {
  const qc = useQueryClient();
  const { data: cages = [] } = useQuery({ queryKey: ["zoo"], queryFn: readZoo });

  const total = useMemo(
    () => cages.reduce((sum, cage) => sum + cage.animals.length, 0),
    [cages],
  );

  const mutate = useMutation({
    mutationFn: async (count) => addAnimals(count),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zoo"] }),
  });
  const clear = useMutation({
    mutationFn: async () => writeZoo(CAGE_TEMPLATE.map((c) => ({ ...c, animals: [] }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zoo"] }),
  });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header emoji="🦁" title="My Zoo" subtitle="Tap to add animals to the cages" />
      <BigCount value={total} unit={total === 1 ? "animal" : "animals"} />

      <View style={styles.buttonRow}>
        <BigButton label="Add one" emoji="➕" onPress={() => mutate.mutate(1)} />
        <BigButton label="Add 1,000" emoji="✨" onPress={() => mutate.mutate(1000)} />
      </View>

      {cages.map((cage) => (
        <View key={cage.name} style={styles.card}>
          <Text style={styles.cardTitle}>
            {cage.emoji}  {cage.name}
            <Text style={styles.cardCount}>   {cage.animals.length.toLocaleString()}</Text>
          </Text>
          {cage.animals.length === 0 ? (
            <Text style={styles.empty}>empty — add some!</Text>
          ) : (
            <Text style={styles.emojiWrap}>
              {cage.animals.slice(0, 40).map((a) => a.emoji).join(" ")}
              {cage.animals.length > 40 ? `  +${(cage.animals.length - 40).toLocaleString()} more` : ""}
            </Text>
          )}
        </View>
      ))}

      <GhostButton label="Clear the zoo" onPress={() => clear.mutate()} />
      <LiveHint />
    </ScrollView>
  );
}

// ==================================================== Toys (AsyncStorage)
// O mini CRUD: create, read, update (rename + favorite), delete.

const TOYS_KEY = "toys";

async function readToys() {
  const raw = await AsyncStorage.getItem(TOYS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
async function writeToys(toys) {
  await AsyncStorage.setItem(TOYS_KEY, JSON.stringify(toys));
}

function ToysScreen() {
  const qc = useQueryClient();
  const { data: toys = [] } = useQuery({ queryKey: ["toys"], queryFn: readToys });

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(TOY_EMOJIS[0]);
  const [editingId, setEditingId] = useState(null);

  const save = useMutation({
    mutationFn: async () => {
      const label = name.trim();
      if (!label) return;
      const current = await readToys();
      if (editingId) {
        await writeToys(
          current.map((t) => (t.id === editingId ? { ...t, name: label, emoji } : t)),
        );
      } else {
        await writeToys([{ id: Date.now(), name: label, emoji, favorite: false }, ...current]);
      }
    },
    onSuccess: () => {
      setName("");
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["toys"] });
    },
  });

  const toggleFavorite = useMutation({
    mutationFn: async (id) => {
      const current = await readToys();
      await writeToys(current.map((t) => (t.id === id ? { ...t, favorite: !t.favorite } : t)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["toys"] }),
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      const current = await readToys();
      await writeToys(current.filter((t) => t.id !== id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["toys"] }),
  });

  function startEdit(toy) {
    setEditingId(toy.id);
    setName(toy.name);
    setEmoji(toy.emoji);
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Header emoji="🧸" title="My Toy Box" subtitle="Add, rename, star and remove your toys" />

      <View style={styles.emojiPicker}>
        {TOY_EMOJIS.map((e) => (
          <Pressable key={e} onPress={() => setEmoji(e)} style={[styles.emojiChoice, emoji === e && styles.emojiChoiceOn]}>
            <Text style={styles.emojiChoiceText}>{e}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.inputRow}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name your toy"
          placeholderTextColor="#a8a29a"
          style={styles.input}
          onSubmitEditing={() => save.mutate()}
        />
        <Pressable style={styles.addButton} onPress={() => save.mutate()}>
          <Text style={styles.addButtonText}>{editingId ? "Save" : "Add"}</Text>
        </Pressable>
      </View>

      <BigCount value={toys.length} unit={toys.length === 1 ? "toy" : "toys"} />

      {toys.length === 0 ? (
        <Text style={styles.emptyBig}>No toys yet.{"\n"}Add your first one above! 👆</Text>
      ) : (
        toys.map((toy) => (
          <View key={toy.id} style={styles.toyRow}>
            <Text style={styles.toyEmoji}>{toy.emoji}</Text>
            <Pressable style={styles.toyNameWrap} onPress={() => startEdit(toy)}>
              <Text style={styles.toyName}>{toy.name}</Text>
              <Text style={styles.toyHint}>tap to rename</Text>
            </Pressable>
            <Pressable style={styles.iconButton} onPress={() => toggleFavorite.mutate(toy.id)}>
              <Text style={styles.iconText}>{toy.favorite ? "⭐" : "☆"}</Text>
            </Pressable>
            <Pressable style={styles.iconButton} onPress={() => remove.mutate(toy.id)}>
              <Text style={styles.iconText}>🗑️</Text>
            </Pressable>
          </View>
        ))
      )}
      <LiveHint />
    </ScrollView>
  );
}

// ==================================================== Scores (SQLite)
// Tabela simples, feita para volume: um clique adiciona 10.000 jogadores.

async function readScores() {
  const db = await getDb();
  const [countRow] = await db.getAllAsync("SELECT COUNT(*) AS n FROM players");
  const top = await db.getAllAsync(
    "SELECT id, name, emoji, score FROM players ORDER BY score DESC, id ASC LIMIT 10",
  );
  return { total: Number(countRow?.n ?? 0), top };
}

async function insertPlayers(count) {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  const started = Date.now();
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(
      "INSERT INTO players (name, emoji, score, created_at) VALUES (?, ?, ?, ?)",
    );
    try {
      for (let i = 0; i < count; i += 1) {
        await stmt.executeAsync([
          randomFrom(PLAYER_NAMES),
          randomFrom(ANIMALS),
          randomInt(0, 1_000_000),
          createdAt,
        ]);
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
  // Par do log da aba Photos: as duas medidas juntas dizem se o volume de
  // eventos do updateHook do op-sqlite custa caro no thread JS.
  if (count > 1) {
    console.log(`[playground] expo-sqlite: ${count} inserts em ${Date.now() - started}ms`);
  }
}

async function clearScores() {
  const db = await getDb();
  await db.execAsync("DELETE FROM players; DELETE FROM sqlite_sequence WHERE name = 'players';");
}

// Botão secreto (long-press no troféu): zera 100% do storage que este app usa —
// MMKV, AsyncStorage e todas as tabelas do SQLite. Serve para resetar entre
// tomadas da demo sem reinstalar o app.
async function wipeEverything() {
  // MMKV
  try {
    zoo.clearAll();
    session.clearAll();
  } catch {
    for (const key of zoo.getAllKeys()) zoo.delete(key);
    for (const key of session.getAllKeys()) session.delete(key);
  }
  // AsyncStorage
  await AsyncStorage.clear();
  // SQLite — esvazia toda tabela de usuário e reseta os AUTOINCREMENT.
  const db = await getDb();
  const tables = await db.getAllAsync(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  for (const { name } of tables) {
    await db.execAsync(`DELETE FROM "${name}"`);
  }
  try {
    await db.execAsync("DELETE FROM sqlite_sequence");
  } catch {
    /* sqlite_sequence só existe depois do 1º insert com AUTOINCREMENT */
  }
  // op-sqlite é OUTRO banco, em outra conexão: o wipe não o alcançava, e como
  // este é o botão de reset entre tomadas, a aba Photos ficava com dado velho.
  const photos = await getPhotosDb();
  const { rows: photoTables } = await photos.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  for (const { name } of photoTables ?? []) {
    await photos.execute(`DELETE FROM "${name}"`);
  }
  try {
    await photos.execute("DELETE FROM sqlite_sequence");
  } catch {
    /* idem */
  }
}

// ==================================================== Photos (op-sqlite)
// A aba que exercita o que a de SQLite não exercita: coluna BLOB (que volta
// como ArrayBuffer neste driver) e UPDATE. E um segundo provider de banco no
// Studio, ao lado do expo-sqlite.

async function readPhotos() {
  const db = await getPhotosDb();
  const { rows: countRows } = await db.execute("SELECT COUNT(*) AS n FROM photos");
  // length(thumb) em vez de thumb: a listagem não precisa trazer os bytes.
  const { rows: latest } = await db.execute(
    `SELECT id, title, emoji, likes, length(thumb) AS thumb_bytes
       FROM photos ORDER BY id DESC LIMIT 10`,
  );
  return { total: Number(countRows?.[0]?.n ?? 0), latest: latest ?? [] };
}

async function insertPhotos(count, thumbBytes) {
  const db = await getPhotosDb();
  const createdAt = new Date().toISOString();
  const started = Date.now();
  const params = Array.from({ length: count }, () => {
    const index = randomInt(0, PHOTO_TITLES.length - 1);
    return [
      PHOTO_TITLES[index],
      PHOTO_EMOJIS[index],
      thumbBytes > 0 ? makeThumb(thumbBytes) : null,
      randomInt(0, 500),
      createdAt,
    ];
  });
  // Um comando com N conjuntos de parâmetros — o op-sqlite embrulha em
  // transação sozinho.
  await db.executeBatch([
    ["INSERT INTO photos (title, emoji, thumb, likes, created_at) VALUES (?, ?, ?, ?, ?)", params],
  ]);
  if (count > 1) {
    // Comparar com a aba Scores (expo-sqlite) diz se o volume de eventos do
    // updateHook está custando caro no thread JS.
    console.log(`[playground] op-sqlite: ${count} inserts em ${Date.now() - started}ms`);
  }
}

/** UPDATE — o hook nativo do op-sqlite reporta a operação de verdade. */
async function likePhoto(id) {
  const db = await getPhotosDb();
  await db.execute("UPDATE photos SET likes = likes + 1 WHERE id = ?", [id]);
}

async function renamePhoto(id) {
  const db = await getPhotosDb();
  const index = randomInt(0, PHOTO_TITLES.length - 1);
  await db.execute("UPDATE photos SET title = ?, emoji = ? WHERE id = ?", [
    PHOTO_TITLES[index],
    PHOTO_EMOJIS[index],
    id,
  ]);
}

/** DELETE sem WHERE: o caso que o updateHook NÃO reporta. */
async function clearPhotos() {
  const db = await getPhotosDb();
  await db.execute("DELETE FROM photos");
  await db.execute("DELETE FROM sqlite_sequence WHERE name = 'photos'");
}

function PhotosScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["photos"], queryFn: readPhotos });
  const total = data?.total ?? 0;
  const latest = data?.latest ?? [];

  const refresh = { onSuccess: () => qc.invalidateQueries({ queryKey: ["photos"] }) };
  const add = useMutation({ mutationFn: ({ count, thumb }) => insertPhotos(count, thumb), ...refresh });
  const like = useMutation({ mutationFn: likePhoto, ...refresh });
  const rename = useMutation({ mutationFn: renamePhoto, ...refresh });
  const clear = useMutation({ mutationFn: clearPhotos, ...refresh });

  const busy = add.isPending;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header emoji="📸" title="Photo Roll" subtitle="Thumbnails live in a BLOB column" />
      <BigCount value={total} unit={total === 1 ? "photo" : "photos"} />

      <View style={styles.buttonRow}>
        <BigButton
          label="Add one"
          emoji="➕"
          onPress={() => add.mutate({ count: 1, thumb: 96 })}
        />
        <BigButton
          label={busy ? "Adding…" : "Add 10,000"}
          emoji="🚀"
          onPress={() => add.mutate({ count: 10000, thumb: 0 })}
          disabled={busy}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Latest</Text>
        {latest.length === 0 ? (
          <Text style={styles.empty}>No photos yet — add some!</Text>
        ) : (
          latest.map((photo) => (
            <View key={photo.id} style={styles.scoreRow}>
              <Pressable onPress={() => rename.mutate(photo.id)}>
                <Text style={styles.scoreEmoji}>{photo.emoji}</Text>
              </Pressable>
              <Pressable style={styles.photoLabel} onPress={() => rename.mutate(photo.id)}>
                <Text style={styles.scoreName}>{photo.title}</Text>
                <Text style={styles.photoMeta}>
                  {photo.thumb_bytes ? `${photo.thumb_bytes} B thumb` : "no thumb"}
                </Text>
              </Pressable>
              <Pressable onPress={() => like.mutate(photo.id)}>
                <Text style={styles.scoreValue}>♥ {photo.likes}</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <GhostButton
        label="Add one with an 8 KB thumb"
        onPress={() => add.mutate({ count: 1, thumb: 8000 })}
      />
      <GhostButton label="Clear the roll" onPress={() => clear.mutate()} />
      <LiveHint />
    </ScrollView>
  );
}

function ScoresScreen() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["scores"], queryFn: readScores });
  const total = data?.total ?? 0;
  const top = data?.top ?? [];
  const [wiped, setWiped] = useState(false);

  const add = useMutation({
    mutationFn: async (count) => insertPlayers(count),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scores"] }),
  });
  const clear = useMutation({
    mutationFn: clearScores,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scores"] }),
  });
  // O gatilho secreto: apaga tudo e atualiza as três abas de uma vez.
  const wipe = useMutation({
    mutationFn: wipeEverything,
    onSuccess: () => {
      qc.invalidateQueries();
      setWiped(true);
      setTimeout(() => setWiped(false), 1800);
    },
  });

  const busy = add.isPending;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header
        emoji="🏆"
        title="High Scores"
        subtitle={wiped ? "✨ Everything wiped!" : "A leaderboard that loves big numbers"}
        onSecretPress={() => wipe.mutate()}
      />
      <BigCount value={total} unit={total === 1 ? "player" : "players"} />

      <View style={styles.buttonRow}>
        <BigButton label="Add one" emoji="➕" onPress={() => add.mutate(1)} />
        <BigButton label={busy ? "Adding…" : "Add 10,000"} emoji="🚀" onPress={() => add.mutate(10000)} disabled={busy} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top 10</Text>
        {top.length === 0 ? (
          <Text style={styles.empty}>No players yet — add some!</Text>
        ) : (
          top.map((p, index) => (
            <View key={p.id} style={styles.scoreRow}>
              <Text style={styles.rank}>{index + 1}</Text>
              <Text style={styles.scoreEmoji}>{p.emoji}</Text>
              <Text style={styles.scoreName}>{p.name}</Text>
              <Text style={styles.scoreValue}>{p.score.toLocaleString()}</Text>
            </View>
          ))
        )}
      </View>

      <GhostButton label="Clear the board" onPress={() => clear.mutate()} />
      <LiveHint />
    </ScrollView>
  );
}

// ==================================================== API (Network)
// Esta aba existe para exercitar o módulo de Network. Faz requests HTTP reais
// (dummyjson.com — público, HTTPS, sem setup) e, de propósito, GRAVA no storage
// logo depois de algumas respostas: é isso que faz o painel "Storage impact"
// acender (correlação temporal honesta, "este request mexeu nestas chaves").

const API = "https://dummyjson.com";
const TOKEN_KEY = "auth.token";

// POST com body + login real: a resposta traz um token, gravado na hora.
// -> Storage impact no request de login (AsyncStorage auth.token + MMKV user).
async function apiSignIn() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "emilys", password: "emilyspass", expiresInMins: 30 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  await AsyncStorage.setItem(TOKEN_KEY, data.accessToken ?? data.token ?? "");
  session.set(
    "user",
    JSON.stringify({
      id: data.id,
      username: data.username,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
    }),
  );
  return data;
}

// GET autenticado: manda o token no header Authorization (aparece no viewer do
// request) e grava o perfil logo depois. -> Storage impact (MMKV profile).
async function apiLoadProfile() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API}/auth/me`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  session.set("profile", JSON.stringify(data));
  return data;
}

// Três GETs de uma vez no MESMO path -> agrupam como "GET .../products (3)".
async function apiBrowse() {
  const responses = await Promise.all([
    fetch(`${API}/products?limit=10&skip=0`),
    fetch(`${API}/products?limit=10&skip=10`),
    fetch(`${API}/products?limit=10&skip=20`),
  ]);
  const pages = await Promise.all(responses.map((r) => r.json()));
  return pages.flatMap((p) => p.products ?? []);
}

// 404 de propósito: exercita o filtro por status e a cor de erro na lista.
async function apiTriggerError() {
  const res = await fetch(`${API}/products/999999`);
  return res.status;
}

// Resposta NÃO-JSON (text/plain): um IP cru, uma string simples de verdade.
// Valida o viewer de string do Network — o corpo aparece INTEIRO, com quebra de
// linha, em vez da tela "invalid JSON" que o viewer de JSON mostraria.
async function apiPlainText() {
  const res = await fetch("https://api.ipify.org?format=text");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

const GRAPHQL_API = "https://graphqlzero.almansi.me/api";

async function graphQLRequest(query, variables, operationName) {
  const res = await fetch(GRAPHQL_API, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Playground-Client": "NativeScope",
    },
    body: JSON.stringify({ query, variables, operationName }),
  });
  const payload = await res.json();
  return { status: res.status, payload };
}

async function graphQLLoadUser() {
  const result = await graphQLRequest(
    `query GetUser($id: ID!) {
      user(id: $id) {
        id
        name
        username
        email
        company { name }
      }
    }`,
    { id: "1" },
    "GetUser",
  );
  if (result.payload.data?.user) {
    session.set("graphql.user", JSON.stringify(result.payload.data.user));
  }
  return result;
}

async function graphQLLoadPosts() {
  return graphQLRequest(
    `query GetPosts($options: PageQueryOptions) {
      posts(options: $options) {
        data { id title body }
        meta { totalCount }
      }
    }`,
    { options: { paginate: { page: 1, limit: 5 } } },
    "GetPosts",
  );
}

async function graphQLCreatePost() {
  const result = await graphQLRequest(
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        id
        title
        body
      }
    }`,
    {
      input: {
        title: `NativeScope replay ${Date.now()}`,
        body: "Created from the NativeScope playground",
      },
    },
    "CreatePost",
  );
  if (result.payload.data?.createPost) {
    session.set(
      "graphql.lastMutation",
      JSON.stringify(result.payload.data.createPost),
    );
  }
  return result;
}

async function graphQLTriggerError() {
  return graphQLRequest(
    `query BrokenProduct {
      post(id: 1) {
        id
        fieldThatDoesNotExist
      }
    }`,
    {},
    "BrokenProduct",
  );
}

async function readSession() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const raw = session.getString("user");
  let user = null;
  if (raw) {
    try {
      user = JSON.parse(raw);
    } catch {
      user = null;
    }
  }
  return { token, user };
}

function ApiScreen() {
  const qc = useQueryClient();
  const { data: sess } = useQuery({ queryKey: ["session"], queryFn: readSession });
  const [products, setProducts] = useState([]);
  const [note, setNote] = useState(null);
  const [requestMode, setRequestMode] = useState("http");
  const [graphQLResult, setGraphQLResult] = useState(null);

  const signIn = useMutation({
    mutationFn: apiSignIn,
    onSuccess: () => {
      setNote("Signed in — token saved to AsyncStorage, user to MMKV");
      qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => setNote(`Sign in failed: ${e.message}`),
  });
  const profile = useMutation({
    mutationFn: apiLoadProfile,
    onSuccess: () => {
      setNote("Profile loaded — saved to MMKV");
      qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => setNote(`Profile failed: ${e.message} — sign in first`),
  });
  const browse = useMutation({
    mutationFn: apiBrowse,
    onSuccess: (list) => {
      setProducts(list);
      setNote(`Loaded ${list.length} products in 3 requests`);
    },
    onError: (e) => setNote(`Browse failed: ${e.message}`),
  });
  const boom = useMutation({
    mutationFn: apiTriggerError,
    onSuccess: (status) => setNote(`Server said HTTP ${status} — on purpose`),
    onError: (e) => setNote(`Request failed: ${e.message}`),
  });
  const plain = useMutation({
    mutationFn: apiPlainText,
    onSuccess: (ip) => setNote(`Plain-text response “${ip}” — open it in the Network tab`),
    onError: (e) => setNote(`Plain text failed: ${e.message}`),
  });
  const gqlUser = useMutation({
    mutationFn: graphQLLoadUser,
    onSuccess: ({ status, payload }) => {
      setGraphQLResult(payload);
      setNote(
        payload.errors?.length
          ? `GraphQL returned ${payload.errors.length} error(s) over HTTP ${status}`
          : "GetUser completed — the user was also saved to MMKV",
      );
    },
    onError: (e) => setNote(`GraphQL query failed: ${e.message}`),
  });
  const gqlPosts = useMutation({
    mutationFn: graphQLLoadPosts,
    onSuccess: ({ status, payload }) => {
      setGraphQLResult(payload);
      setNote(
        payload.errors?.length
          ? `GraphQL returned ${payload.errors.length} error(s) over HTTP ${status}`
          : `GetPosts completed over HTTP ${status}`,
      );
    },
    onError: (e) => setNote(`GraphQL query failed: ${e.message}`),
  });
  const gqlMutation = useMutation({
    mutationFn: graphQLCreatePost,
    onSuccess: ({ status, payload }) => {
      setGraphQLResult(payload);
      setNote(
        payload.errors?.length
          ? `GraphQL returned ${payload.errors.length} error(s) over HTTP ${status}`
          : "CreatePost completed — its result was saved to MMKV",
      );
    },
    onError: (e) => setNote(`GraphQL mutation failed: ${e.message}`),
  });
  const gqlError = useMutation({
    mutationFn: graphQLTriggerError,
    onSuccess: ({ status, payload }) => {
      setGraphQLResult(payload);
      setNote(
        `Intentional GraphQL failure: ${payload.errors?.length ?? 0} error(s), HTTP ${status}`,
      );
    },
    onError: (e) => setNote(`GraphQL request failed: ${e.message}`),
  });

  const signedIn = Boolean(sess?.user);
  const busy =
    signIn.isPending ||
    profile.isPending ||
    browse.isPending ||
    boom.isPending ||
    plain.isPending ||
    gqlUser.isPending ||
    gqlPosts.isPending ||
    gqlMutation.isPending ||
    gqlError.isPending;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header
        emoji="🌐"
        title="Request Playground"
        subtitle="HTTP and GraphQL in the same Network timeline"
      />

      <View style={styles.requestModeSwitch}>
        {[
          { key: "http", label: "HTTP", hint: "REST-style requests" },
          { key: "graphql", label: "GraphQL", hint: "Queries and mutations" },
        ].map((mode) => {
          const active = requestMode === mode.key;
          return (
            <Pressable
              key={mode.key}
              onPress={() => {
                setRequestMode(mode.key);
                setNote(null);
              }}
              style={[
                styles.requestModeButton,
                active && styles.requestModeButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.requestModeLabel,
                  active && styles.requestModeLabelActive,
                ]}
              >
                {mode.label}
              </Text>
              <Text
                style={[
                  styles.requestModeHint,
                  active && styles.requestModeHintActive,
                ]}
              >
                {mode.hint}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {requestMode === "http" ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {signedIn ? `👤  ${sess.user.firstName} ${sess.user.lastName}` : "🔒  Not signed in"}
            </Text>
            <Text style={styles.empty}>
              {signedIn ? `@${sess.user.username} · token in AsyncStorage` : "Sign in to store an auth token"}
            </Text>
          </View>

          <View style={styles.buttonRow}>
            <BigButton label={signIn.isPending ? "Signing in…" : "Sign in"} emoji="🔑" onPress={() => signIn.mutate()} disabled={busy} />
            <BigButton label={profile.isPending ? "Loading…" : "Load profile"} emoji="🪪" onPress={() => profile.mutate()} disabled={busy} />
          </View>
          <View style={styles.buttonRow}>
            <BigButton label={browse.isPending ? "Fetching…" : "Browse ×3"} emoji="🛍️" onPress={() => browse.mutate()} disabled={busy} />
            <BigButton label="Trigger 404" emoji="💥" onPress={() => boom.mutate()} disabled={busy} />
          </View>
          <View style={styles.buttonRow}>
            <BigButton label={plain.isPending ? "Fetching…" : "Plain text"} emoji="🧾" onPress={() => plain.mutate()} disabled={busy} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>GraphQLZero</Text>
            <Text style={styles.empty}>
              Named operations, variables, mutations and semantic errors.
            </Text>
          </View>
          <View style={styles.buttonRow}>
            <BigButton
              label={gqlUser.isPending ? "Querying…" : "Get user"}
              emoji="👤"
              onPress={() => gqlUser.mutate()}
              disabled={busy}
            />
            <BigButton
              label={gqlPosts.isPending ? "Querying…" : "Get posts"}
              emoji="📚"
              onPress={() => gqlPosts.mutate()}
              disabled={busy}
            />
          </View>
          <View style={styles.buttonRow}>
            <BigButton
              label={gqlMutation.isPending ? "Mutating…" : "Create post"}
              emoji="✍️"
              onPress={() => gqlMutation.mutate()}
              disabled={busy}
            />
            <BigButton
              label={gqlError.isPending ? "Querying…" : "GraphQL error"}
              emoji="⚠️"
              onPress={() => gqlError.mutate()}
              disabled={busy}
            />
          </View>
        </>
      )}

      {note ? <Text style={styles.apiNote}>{note}</Text> : null}

      {requestMode === "http" && products.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Latest products<Text style={styles.cardCount}>   {products.length}</Text>
          </Text>
          {products.slice(0, 8).map((p) => (
            <View key={p.id} style={styles.scoreRow}>
              <Text style={styles.scoreName} numberOfLines={1}>{p.title}</Text>
              <Text style={styles.scoreValue}>${p.price}</Text>
            </View>
          ))}
        </View>
      )}

      {requestMode === "graphql" && graphQLResult ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Latest GraphQL result
            <Text style={styles.cardCount}>
              {graphQLResult.errors?.length
                ? `   ${graphQLResult.errors.length} error(s)`
                : "   data"}
            </Text>
          </Text>
          <Text style={styles.graphQLPreview} numberOfLines={10}>
            {JSON.stringify(graphQLResult, null, 2)}
          </Text>
        </View>
      ) : null}

      <View style={styles.impactHint}>
        <Text style={styles.impactHintText}>
          💡 HTTP and GraphQL share one timeline. GraphQL operations are detected
          automatically and show their query, variables, data and errors. “Get
          user” and “Create post” also write to MMKV, so Storage impact lights up.
        </Text>
      </View>
      <LiveHint />
    </ScrollView>
  );
}

// ============================================================ UI compartilhada

function Header({ emoji, title, subtitle, onSecretPress }) {
  const emojiNode = <Text style={styles.headerEmoji}>{emoji}</Text>;
  return (
    <View style={styles.header}>
      {onSecretPress ? (
        // Gatilho secreto: só o long-press dispara — um toque não faz nada,
        // para o reset destrutivo nunca acontecer por acidente na demo.
        <Pressable onLongPress={onSecretPress} delayLongPress={600}>
          {emojiNode}
        </Pressable>
      ) : (
        emojiNode
      )}
      <Text style={styles.headerTitle}>{title}</Text>
      <Text style={styles.headerSubtitle}>{subtitle}</Text>
    </View>
  );
}

function BigCount({ value, unit }) {
  return (
    <View style={styles.bigCount}>
      <Text style={styles.bigCountValue}>{value.toLocaleString()}</Text>
      <Text style={styles.bigCountUnit}>{unit}</Text>
    </View>
  );
}

function BigButton({ label, emoji, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.bigButton, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.bigButtonEmoji}>{emoji}</Text>
      <Text style={styles.bigButtonLabel}>{label}</Text>
    </Pressable>
  );
}

function GhostButton({ label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}>
      <Text style={styles.ghostButtonText}>{label}</Text>
    </Pressable>
  );
}

function LiveHint() {
  return (
    <View style={styles.liveHint}>
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>Live — edit it in NativeScope and watch it change here</Text>
    </View>
  );
}

// ================================================================ estilos

const CORAL = "#d97757";
const INK = "#1f1e1d";
const PAPER = "#faf9f5";
const CARD = "#ffffff";
const BORDER = "#e6e2d9";
const MUTED = "#78736b";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAPER },
  screen: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 16 },

  header: { alignItems: "center", gap: 4, marginTop: 8 },
  headerEmoji: { fontSize: 52 },
  headerTitle: { fontSize: 30, fontWeight: "900", color: INK },
  headerSubtitle: { fontSize: 15, color: MUTED, textAlign: "center" },

  bigCount: {
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: BORDER,
    paddingVertical: 18,
  },
  bigCountValue: { fontSize: 46, fontWeight: "900", color: CORAL },
  bigCountUnit: { fontSize: 16, fontWeight: "700", color: MUTED, marginTop: -4 },

  buttonRow: { flexDirection: "row", gap: 12 },
  bigButton: {
    flex: 1,
    alignItems: "center",
    backgroundColor: CORAL,
    borderRadius: 18,
    paddingVertical: 18,
    gap: 4,
  },
  bigButtonEmoji: { fontSize: 26 },
  bigButtonLabel: { color: "#fff", fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },

  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: BORDER,
    padding: 16,
    gap: 8,
  },
  cardTitle: { fontSize: 18, fontWeight: "800", color: INK },
  cardCount: { fontSize: 15, fontWeight: "800", color: CORAL },
  emojiWrap: { fontSize: 22, lineHeight: 30 },
  empty: { color: MUTED, fontSize: 15, fontStyle: "italic" },
  emptyBig: { color: MUTED, fontSize: 17, textAlign: "center", lineHeight: 26, marginVertical: 12 },

  // Toys / CRUD
  emojiPicker: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  emojiChoice: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD,
  },
  emojiChoiceOn: { borderColor: CORAL, backgroundColor: "#f7ede8" },
  emojiChoiceText: { fontSize: 24 },
  inputRow: { flexDirection: "row", gap: 10 },
  input: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: BORDER,
    paddingHorizontal: 16,
    fontSize: 17,
    color: INK,
    height: 52,
  },
  addButton: {
    backgroundColor: CORAL,
    borderRadius: 14,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  toyRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: BORDER,
    padding: 12,
    gap: 12,
  },
  toyEmoji: { fontSize: 30 },
  toyNameWrap: { flex: 1 },
  toyName: { fontSize: 18, fontWeight: "700", color: INK },
  toyHint: { fontSize: 12, color: "#b0aba2" },
  iconButton: { padding: 6 },
  iconText: { fontSize: 22 },

  // Scores
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f0ece4",
  },
  rank: { fontSize: 15, fontWeight: "900", color: MUTED, width: 22 },
  scoreEmoji: { fontSize: 24 },
  scoreName: { flex: 1, fontSize: 17, fontWeight: "700", color: INK },
  scoreValue: { fontSize: 16, fontWeight: "800", color: CORAL },
  photoLabel: { flex: 1 },
  photoMeta: { fontSize: 12, color: MUTED, marginTop: 1 },

  ghostButton: { alignItems: "center", paddingVertical: 14 },
  ghostButtonText: { color: MUTED, fontSize: 15, fontWeight: "700" },

  liveHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#3f9a63" },
  liveText: { color: MUTED, fontSize: 13 },

  // API / network
  apiNote: { color: MUTED, fontSize: 14, fontWeight: "600", textAlign: "center" },
  requestModeSwitch: {
    flexDirection: "row",
    gap: 8,
    padding: 5,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  requestModeButton: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    borderRadius: 11,
    paddingVertical: 10,
  },
  requestModeButtonActive: { backgroundColor: CORAL },
  requestModeLabel: { color: MUTED, fontSize: 15, fontWeight: "900" },
  requestModeLabelActive: { color: "#fff" },
  requestModeHint: { color: "#aaa49b", fontSize: 11 },
  requestModeHintActive: { color: "#fbe8e0" },
  graphQLPreview: {
    color: INK,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "monospace",
  },
  impactHint: {
    backgroundColor: "#f7ede8",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eaddd4",
    padding: 14,
  },
  impactHintText: { color: "#8a5a44", fontSize: 13, lineHeight: 19 },

  // Tab bar
  tabBar: {
    flexDirection: "row",
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    paddingBottom: 6,
  },
  tab: { flex: 1, alignItems: "center", gap: 2 },
  tabIcon: { fontSize: 24, opacity: 0.4 },
  tabIconActive: { opacity: 1 },
  tabLabel: { fontSize: 12, fontWeight: "700", color: "#b0aba2" },
  tabLabelActive: { color: CORAL },
});
