import { describe, expect, it, vi } from "vitest";
import { createShutdown } from "./shutdown.ts";

describe("shutdown", () => {
  it("roda os passos na ordem e sai com o código pedido", () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      steps: [
        { name: "adb", run: () => order.push("adb") },
        { name: "server", run: () => order.push("server") },
        { name: "session", run: () => order.push("session") },
      ],
      exit,
    });

    shutdown(0);

    expect(order).toEqual(["adb", "server", "session"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("roda uma vez só — Ctrl+C repetido não reentra", () => {
    const run = vi.fn();
    const exit = vi.fn();
    const shutdown = createShutdown({ steps: [{ name: "server", run }], exit });

    shutdown();
    shutdown();
    shutdown();

    expect(run).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("um passo que falha não impede os outros nem a saída", () => {
    const order: string[] = [];
    const exit = vi.fn();
    const onStepError = vi.fn();
    const shutdown = createShutdown({
      steps: [
        {
          name: "adb",
          run: () => {
            throw new Error("adb travou");
          },
        },
        { name: "server", run: () => order.push("server") },
      ],
      exit,
      onStepError,
    });

    shutdown(1);

    expect(order).toEqual(["server"]);
    expect(onStepError).toHaveBeenCalledOnce();
    expect(onStepError.mock.calls[0]?.[0]).toBe("adb");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
