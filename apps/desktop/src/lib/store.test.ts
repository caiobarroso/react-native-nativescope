import { beforeEach, describe, expect, it } from "vitest";
import { activityKey, keysId, useStudio } from "./store.ts";

describe("activityKey", () => {
  it("usa o nome da tabela quando nenhuma view a lê", () => {
    expect(activityKey("items", undefined, 7)).toBe("items · rowid 7");
    expect(activityKey("items", [], null)).toBe("items");
  });

  it("usa o nome da VIEW quando é exatamente uma", () => {
    // Numa base onde o dado físico é JSON opaco, "ps_data__notes" não diz nada
    // ao dev — ele só conhece "notes".
    expect(activityKey("ps_data__notes", ["notes"], null)).toBe("notes");
    expect(activityKey("ps_data__notes", ["notes"], 3)).toBe("notes · rowid 3");
  });

  it("volta para o nome físico quando há mais de uma view", () => {
    // Sem critério para escolher, o nome físico é a resposta honesta.
    expect(activityKey("items", ["a_view", "b_view"], null)).toBe("items");
  });
});

describe("applyDatabaseChange", () => {
  const provider = "expo-sqlite";
  const instance = "app.db";

  beforeEach(() => {
    useStudio.setState({ recentChanges: {}, activity: [], selection: null });
  });

  function change(table: string, views?: string[]) {
    useStudio.getState().applyDatabaseChange({
      providerId: provider,
      providerLabel: "SQLite",
      instanceId: instance,
      table,
      rowId: null,
      operation: "update",
      source: "app",
      timestamp: Date.now(),
      ...(views !== undefined ? { views } : {}),
    });
  }

  it("carimba a tabela alterada E as views que a leem", () => {
    change("ps_data__notes", ["notes", "pinned_notes"]);
    const stamped = Object.keys(useStudio.getState().recentChanges);

    // Sem as views aqui, a escrita acende a linha errada na sidebar: pisca a
    // tabela física, que ninguém abriu, e deixa parada a view que está na tela.
    expect(stamped).toContain(`${keysId(provider, instance)} ps_data__notes`);
    expect(stamped).toContain(`${keysId(provider, instance)} notes`);
    expect(stamped).toContain(`${keysId(provider, instance)} pinned_notes`);
  });

  it("carimba só a tabela quando não há view dependente", () => {
    change("items");
    expect(Object.keys(useStudio.getState().recentChanges)).toEqual([
      `${keysId(provider, instance)} items`,
    ]);
  });

  it("gera UM item de atividade, não um por view", () => {
    change("ps_data__notes", ["notes", "pinned_notes"]);
    // Um evento por view dependente leria como fatos distintos na Timeline sem
    // forma de saber que são a mesma escrita.
    expect(useStudio.getState().activity).toHaveLength(1);
  });

  it("o destino do clique continua sendo a tabela física", () => {
    change("ps_data__notes", ["notes"]);
    const item = useStudio.getState().activity[0];
    expect(item?.key).toBe("notes");
    // É onde a escrita realmente aconteceu, e é para lá que a navegação vai.
    expect(item?.target).toEqual({ kind: "database", table: "ps_data__notes", rowId: null });
  });
});
