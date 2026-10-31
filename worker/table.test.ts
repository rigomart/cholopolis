/// <reference types="bun" />

import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { act, addPlayer, createGame, type GameState } from "../shared/game.ts";
import type { GameRecord } from "../shared/leaderboard.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { EXPIRE_MS } from "./alarm.ts";

// Bun has no Workers runtime.
mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
const { Table } = await import("./table.ts");
const autoResponse = Object.getOwnPropertyDescriptor(globalThis, "WebSocketRequestResponsePair");
Object.defineProperty(globalThis, "WebSocketRequestResponsePair", {
  configurable: true,
  value: class {
    request: string;
    response: string;
    constructor(request: string, response: string) {
      this.request = request;
      this.response = response;
    }
  },
});
afterAll(() => {
  if (autoResponse) Object.defineProperty(globalThis, "WebSocketRequestResponsePair", autoResponse);
  else Reflect.deleteProperty(globalThis, "WebSocketRequestResponsePair");
});

class Socket {
  readyState: number = WebSocket.OPEN;
  messages: ServerMessage[] = [];
  attachment: { token: string; playerId: string | null; name: string | null };

  constructor(playerId: string | null) {
    this.attachment = { token: `token-${playerId}`, playerId, name: playerId };
  }

  deserializeAttachment() {
    return structuredClone(this.attachment);
  }

  serializeAttachment(attachment: typeof this.attachment) {
    this.attachment = structuredClone(attachment);
  }

  send(message: string) {
    this.messages.push(JSON.parse(message) as ServerMessage);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
  }
}

async function table(
  game: GameState,
  sockets: Socket[],
  onReport = async () => {},
  onRecord = async (_record: GameRecord) => {},
) {
  const data = new Map<string, unknown>([
    ["game", structuredClone(game)],
    ["room", "room1234"],
    ["tokens", Object.fromEntries(game.players.filter((p) => !p.bot).map((p) => [`token-${p.id}`, p.id]))],
  ]);
  let alarm: number | null = null;
  let ready = Promise.resolve();
  const reports: boolean[] = [];
  const ctx = {
    storage: {
      get: async (key: string) => structuredClone(data.get(key)),
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        for (const [k, v] of typeof key === "string" ? [[key, value]] : Object.entries(key)) {
          data.set(k as string, structuredClone(v));
        }
      },
      deleteAll: async () => {
        data.clear();
        alarm = null;
      },
      setAlarm: async (at: number) => {
        alarm = at;
      },
      deleteAlarm: async () => {
        alarm = null;
      },
    },
    getWebSockets: () => sockets,
    setWebSocketAutoResponse: () => {},
    blockConcurrencyWhile: (load: () => Promise<void>) => {
      ready = load();
      return ready;
    },
  };
  const env = {
    LEADERBOARD: { idFromName: () => "main", get: () => ({ record: onRecord }) },
    LOBBY: {
      idFromName: () => "main",
      get: () => ({
        report: async (_room: string, open: boolean) => {
          reports.push(open);
          await onReport();
        },
      }),
    },
  };
  const load = async () => {
    const instance = new Table(ctx as unknown as DurableObjectState, env as unknown as Env);
    await ready;
    return instance;
  };
  return {
    instance: await load(),
    reload: load,
    data,
    reports,
    alarm: () => alarm,
    dispatch: async <T>(event: () => T) => {
      await ready;
      return event();
    },
  };
}

const now = 1_000_000;
afterEach(() => mock.restore());

function botGame(): GameState {
  const game = createGame();
  addPlayer(game, "a", "Rosa");
  act(game, "a", { type: "addBot" }, () => 0);
  act(game, "a", { type: "start" }, () => 0);
  return game;
}

describe("table lifecycle", () => {
  test("an empty bot game pauses until its stored state is deleted after 24 hours", async () => {
    const socket = new Socket("a");
    const room = await table(botGame(), [socket]);
    const clock = spyOn(Date, "now").mockReturnValue(now);
    await room.instance.webSocketClose(socket as unknown as WebSocket, 1000, "");
    expect(room.alarm()).toBe(now + EXPIRE_MS);
    expect(room.data.get("game")).toMatchObject({ phase: "playing", rollId: 0 });
    clock.mockReturnValue(now + EXPIRE_MS);
    await room.instance.alarm();
    expect(room.instance.exists()).toBe(false);
    expect(room.data.size).toBe(0);
    expect(room.alarm()).toBe(null);
  });

  test("an early alarm cannot delete a recently abandoned bot game", async () => {
    const socket = new Socket("a");
    const room = await table(botGame(), [socket]);
    const clock = spyOn(Date, "now").mockReturnValue(now);
    await room.instance.webSocketClose(socket as unknown as WebSocket, 1000, "");
    clock.mockReturnValue(now + 1000);
    await room.instance.alarm();
    expect(room.instance.exists()).toBe(true);
    expect(room.data.get("game")).toMatchObject({ phase: "playing", rollId: 0 });
    expect(room.alarm()).toBe(now + EXPIRE_MS);
  });

  test("repeated close notifications do not postpone empty-room cleanup", async () => {
    const socket = new Socket("a");
    const room = await table(botGame(), [socket]);
    const clock = spyOn(Date, "now").mockReturnValue(now);
    await room.instance.webSocketClose(socket as unknown as WebSocket, 1000, "");
    clock.mockReturnValue(now + 5000);
    await room.instance.webSocketClose(socket as unknown as WebSocket, 1000, "");
    expect(room.alarm()).toBe(now + EXPIRE_MS);
  });

  test("the cleanup deadline survives hibernation", async () => {
    const socket = new Socket("a");
    const room = await table(botGame(), [socket]);
    const clock = spyOn(Date, "now").mockReturnValue(now);
    await room.instance.webSocketClose(socket as unknown as WebSocket, 1000, "");
    const restored = await room.reload();
    clock.mockReturnValue(now + 1000);
    await restored.alarm();
    expect(restored.exists()).toBe(true);
    expect(room.alarm()).toBe(now + EXPIRE_MS);
    clock.mockReturnValue(now + EXPIRE_MS);
    await restored.alarm();
    expect(restored.exists()).toBe(false);
    expect(room.data.size).toBe(0);
  });

  test("a returning player cancels expiry and the next departure starts a fresh grace period", async () => {
    const socket = new Socket("a");
    const sockets = [socket];
    const room = await table(botGame(), sockets);
    const clock = spyOn(Date, "now").mockReturnValue(now);
    await room.instance.webSocketClose(socket as unknown as WebSocket, 1000, "");
    clock.mockReturnValue(now + EXPIRE_MS - 1000);
    const returning = new Socket("a");
    sockets.push(returning);
    await room.instance.webSocketMessage(
      returning as unknown as WebSocket,
      JSON.stringify({ type: "join", name: "Rosa" }),
    );
    expect(returning.messages.at(-1)).toMatchObject({ type: "state", you: "a" });
    expect(room.alarm()).toBeLessThan(now + EXPIRE_MS + 60_000);
    clock.mockReturnValue(now + EXPIRE_MS + 1000);
    await room.instance.webSocketClose(returning as unknown as WebSocket, 1000, "");
    expect(room.instance.exists()).toBe(true);
    expect(room.alarm()).toBe(now + 2 * EXPIRE_MS + 1000);
  });

  test("an older empty room without an expiry timestamp is eventually cleaned up", async () => {
    const room = await table(botGame(), []);
    const clock = spyOn(Date, "now").mockReturnValue(now);
    await room.instance.alarm();
    expect(room.instance.exists()).toBe(true);
    expect(room.alarm()).toBe(now + EXPIRE_MS);
    clock.mockReturnValue(now + EXPIRE_MS);
    await room.instance.alarm();
    expect(room.instance.exists()).toBe(false);
  });

  test("incoming events wait until expiry has finished clearing the room", async () => {
    let pause = false;
    let reportStarted!: () => void;
    let finishReport!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finishReport = resolve;
    });
    const socket = new Socket("a");
    const room = await table(botGame(), [socket], async () => {
      if (!pause) return;
      reportStarted();
      await finished;
    });
    const clock = spyOn(Date, "now").mockReturnValue(now);
    await room.instance.webSocketClose(socket as unknown as WebSocket, 1000, "");
    const restored = await room.reload();
    pause = true;
    clock.mockReturnValue(now + EXPIRE_MS);
    const expiry = restored.alarm();
    await started;
    const lookup = room.dispatch(() => restored.exists());
    await Promise.resolve();
    finishReport();
    await expiry;
    expect(await lookup).toBe(false);
    expect(room.data.size).toBe(0);
  });

  test("a full lobby advertises the seat freed by a disconnected player", async () => {
    const game = createGame();
    const sockets = Array.from("abcdefgh", (id) => {
      addPlayer(game, id, id);
      return new Socket(id);
    });
    const room = await table(game, sockets);
    await room.instance.webSocketClose(sockets[7] as unknown as WebSocket, 1000, "");
    expect(room.reports.at(-1)).toBe(true);
  });

  test("replacing a disconnected lobby seat removes its obsolete token", async () => {
    const game = createGame();
    const sockets = Array.from("abcdefgh", (id) => {
      addPlayer(game, id, id);
      return new Socket(id);
    });
    const room = await table(game, sockets);
    await room.instance.webSocketClose(sockets[7] as unknown as WebSocket, 1000, "");
    expect(room.data.get("tokens")).toHaveProperty("token-h", "h");
    const newcomer = new Socket(null);
    newcomer.attachment.token = "newcomer-token";
    sockets.push(newcomer);
    await room.instance.webSocketMessage(
      newcomer as unknown as WebSocket,
      JSON.stringify({ type: "join", name: "Newcomer" }),
    );
    expect((room.data.get("game") as GameState).players.some((p) => p.id === "h")).toBe(false);
    const tokens = room.data.get("tokens") as Record<string, string>;
    expect(Object.keys(tokens)).toHaveLength(8);
    expect(tokens).not.toHaveProperty("token-h");
    expect(tokens["newcomer-token"]).toBe(newcomer.attachment.playerId as string);
  });

  test("starting a game discards tokens for seats left out of the game", async () => {
    const game = createGame();
    addPlayer(game, "a", "Rosa");
    addPlayer(game, "b", "Beto");
    addPlayer(game, "c", "Cata");
    const socket = new Socket("a");
    const room = await table(game, [socket, new Socket("b")]);
    await room.instance.webSocketMessage(
      socket as unknown as WebSocket,
      JSON.stringify({ type: "action", action: { type: "start" } }),
    );
    expect(room.data.get("game")).toMatchObject({ phase: "playing" });
    expect(room.data.get("tokens")).toEqual({ "token-a": "a", "token-b": "b" });
  });
});

function finishedGame(): GameState {
  const game = createGame();
  addPlayer(game, "a", "Rosa");
  addPlayer(game, "b", "Beto");
  act(game, "a", { type: "start" }, () => 0, 1000);
  act(game, "b", { type: "bankrupt" }, () => 0, 2000);
  return game;
}

describe("leaderboard retries", () => {
  test("a rematch retries a finished result after the leaderboard recovers", async () => {
    let attempts = 0;
    const recorded: GameRecord[] = [];
    spyOn(console, "error").mockImplementation(() => {});
    const socket = new Socket("a");
    const room = await table(
      finishedGame(),
      [socket],
      async () => {},
      async (record) => {
        if (++attempts === 1) throw new Error("temporary leaderboard outage");
        recorded.push(record);
      },
    );
    await room.instance.webSocketMessage(
      socket as unknown as WebSocket,
      JSON.stringify({ type: "join", name: "Rosa" }),
    );
    expect(attempts).toBe(1);
    const restored = await room.reload();
    await restored.webSocketMessage(
      socket as unknown as WebSocket,
      JSON.stringify({ type: "action", action: { type: "rematch" } }),
    );
    expect((room.data.get("game") as GameState).phase).toBe("lobby");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ id: "room1234:1000", players: [{ name: "Rosa" }, { name: "Beto" }] });
    expect(recorded[0]?.players.every((p) => p.key !== null)).toBe(true);
    expect(room.data.get("tokens")).toEqual({ "token-a": "a" });
  });

  test("a rematch preserves the finished game until its result can be saved", async () => {
    let unavailable = true;
    const recorded: GameRecord[] = [];
    spyOn(console, "error").mockImplementation(() => {});
    const socket = new Socket("a");
    const room = await table(
      finishedGame(),
      [socket, new Socket("b")],
      async () => {},
      async (record) => {
        if (unavailable) throw new Error("temporary leaderboard outage");
        recorded.push(record);
      },
    );
    const rematch = JSON.stringify({ type: "action", action: { type: "rematch" } });
    await room.instance.webSocketMessage(socket as unknown as WebSocket, rematch);
    expect(room.data.get("game")).toMatchObject({ phase: "ended", winnerId: "a" });
    expect(socket.messages.at(-1)).toMatchObject({ type: "error" });
    unavailable = false;
    await room.instance.webSocketMessage(socket as unknown as WebSocket, rematch);
    expect(room.data.get("game")).toMatchObject({ phase: "lobby" });
    expect(recorded).toHaveLength(1);
  });
});
