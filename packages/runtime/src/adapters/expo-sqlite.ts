import { createSqliteAdapter, type SqliteAdapter } from "./sqlite-core.ts";

export type { SQLiteDatabaseLike } from "./sqlite-core.ts";

/**
 * Alias, não `interface ExpoSqliteAdapter extends SqliteAdapter {}`: a interface
 * vazia permitiria que alguém acrescentasse um membro só aqui e o adapter de
 * outro driver deixasse de ser assignable sem ninguém perceber.
 */
export type ExpoSqliteAdapter = SqliteAdapter;

/**
 * expo-sqlite. O comportamento inteiro vem do core — aqui mora só a identidade.
 *
 * `label: "SQLite"` sem qualificar o engine é intencional: é o nome que o
 * usuário vê no Studio desde a v1.0 e renomear seria mexer numa UI em produção.
 * Outros drivers se identificam pelo próprio nome (ver op-sqlite.ts).
 */
export function createExpoSqliteAdapter(): ExpoSqliteAdapter {
  return createSqliteAdapter({ providerId: "expo-sqlite", label: "SQLite" });
}
