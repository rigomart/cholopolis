import { describe, expect, test } from "bun:test";

import { alarmTask, BOT_DELAY_MS, EXPIRE_MS, nextAlarm, nextBotAt } from "../worker/alarm.ts";
import { isOwnable, MAX_PLAYERS, square } from "./board.ts";
import { BOT_RESERVE, botMove, decide } from "./bots.ts";
import { turnLimit, TURN_MS } from "./clock.ts";
import { act, addPlayer, autoPlay, BOT_NAMES, createGame, type GameState, type Player, syncPresence } from "./game.ts";
import { parseClientMessage } from "./protocol.ts";

function lobby(bots = 1): GameState {
  const g = createGame();
  addPlayer(g, "a", "Rosa");
  for (let i = 0; i < bots; i++) act(g, "a", { type: "addBot" }, () => 0);
  return g;
}

function botTurn(): { g: GameState; bot: Player } {
  const g = lobby(1);
  act(g, "a", { type: "start" }, () => 0);
  const bot = g.players.find((p) => p.bot) as Player;
  g.turn = { playerId: bot.id, stage: "roll", doubles: 0, rolledDoubles: false };
  return { g, bot };
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe("seating bots", () => {
  test("the host adds named bots that count as present players and can start a game", () => {
    const g = lobby(2);
    expect(g.players.map((p) => [p.name, Boolean(p.bot)])).toEqual([
      ["Rosa", false],
      [BOT_NAMES[0], true],
      [BOT_NAMES[1], true],
    ]);
    expect(new Set(g.players.map((p) => p.color)).size).toBe(3);
    expect(new Set(g.players.map((p) => p.piece)).size).toBe(3);
    syncPresence(g, new Set(["a"]));
    expect(g.players.every((p) => p.connected)).toBe(true);
    act(g, "a", { type: "start" }, () => 0);
    expect(g.phase).toBe("playing");
    expect(g.players).toHaveLength(3);
  });

  test("bots fill up to the seat limit and only the host adds or removes them", () => {
    const g = lobby(MAX_PLAYERS - 1);
    expect(g.players).toHaveLength(MAX_PLAYERS);
    expect(() => act(g, "a", { type: "addBot" }, () => 0)).toThrow("llena");
    const bot = g.players[1] as Player;
    act(g, "a", { type: "removeBot", player: bot.id }, () => 0);
    expect(g.players).toHaveLength(MAX_PLAYERS - 1);
    expect(() => act(g, "a", { type: "removeBot", player: "a" }, () => 0)).toThrow("no es un bot");

    addPlayer(g, "b", "Beto");
    const other = g.players[1] as Player;
    expect(() => act(g, "b", { type: "addBot" }, () => 0)).toThrow("Solo quien abrió");
    expect(() => act(g, "b", { type: "removeBot", player: other.id }, () => 0)).toThrow("Solo quien abrió");
  });

  test("a freed bot name is reused before a later one", () => {
    const g = lobby(3);
    const grau = g.players.find((p) => p.name === BOT_NAMES[1]) as Player;
    act(g, "a", { type: "removeBot", player: grau.id }, () => 0);
    act(g, "a", { type: "addBot" }, () => 0);
    expect(g.players.map((p) => p.name)).toContain(BOT_NAMES[1]);
  });

  test("bots can't be added once the game starts", () => {
    const { g } = botTurn();
    expect(() => act(g, "a", { type: "addBot" }, () => 0)).toThrow("ya empezó");
  });

  test("the host role never goes to a bot", () => {
    const g = lobby(2);
    syncPresence(g, new Set());
    expect(g.hostId).toBe("a");
    addPlayer(g, "b", "Beto");
    syncPresence(g, new Set(["b"]));
    expect(g.hostId).toBe("b");
  });

  test("a bot is never on the short clock for a disconnected player", () => {
    const { g } = botTurn();
    syncPresence(g, new Set());
    expect(turnLimit(g)).toBe(TURN_MS);
  });

  test("a bot never forfeits for timed-out turns, even if marked disconnected", () => {
    const { g, bot } = botTurn();
    for (let i = 0; i < 4; i++) {
      bot.connected = false;
      g.turn = { playerId: bot.id, stage: "roll", doubles: 0, rolledDoubles: false };
      autoPlay(g, () => 0.5);
    }
    expect(bot.bankrupt).toBe(false);
    expect(bot.idleTurns).toBe(0);
  });

  test("the lobby messages parse", () => {
    expect(parseClientMessage(JSON.stringify({ type: "action", action: { type: "addBot" } }))).toEqual({
      type: "action",
      action: { type: "addBot" },
    });
    expect(
      parseClientMessage(JSON.stringify({ type: "action", action: { type: "removeBot", player: "bot-3" } })),
    ).toEqual({ type: "action", action: { type: "removeBot", player: "bot-3" } });
    expect(parseClientMessage(JSON.stringify({ type: "action", action: { type: "removeBot", player: 3 } }))).toBe(null);
  });
});

describe("bot decisions", () => {
  test("rolls on its turn and waits on someone else's", () => {
    const { g, bot } = botTurn();
    expect(decide(g, bot.id)).toEqual({ type: "roll" });
    g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
    expect(decide(g, bot.id)).toBe(null);
    expect(botMove(g)).toBe(null);
  });

  test("buys only what leaves it the reserve", () => {
    const { g, bot } = botTurn();
    g.turn = { playerId: bot.id, stage: "buy", doubles: 0, rolledDoubles: false };
    bot.position = 39;
    const sq = square(39);
    const price = isOwnable(sq) ? sq.price : 0;
    bot.cash = price + BOT_RESERVE;
    expect(decide(g, bot.id)).toEqual({ type: "buy" });
    bot.cash--;
    expect(decide(g, bot.id)).toEqual({ type: "decline" });
  });

  test("ends its turn once done", () => {
    const { g, bot } = botTurn();
    g.turn = { playerId: bot.id, stage: "done", doubles: 0, rolledDoubles: false };
    expect(decide(g, bot.id)).toEqual({ type: "endTurn" });
  });

  test("in debt it sells evenly, then mortgages, then goes bankrupt", () => {
    const { g, bot } = botTurn();
    g.props[1] = { owner: bot.id, houses: 1, mortgaged: false };
    g.props[3] = { owner: bot.id, houses: 2, mortgaged: false };
    bot.cash = -10;
    expect(decide(g, bot.id)).toEqual({ type: "sell", square: 3 });
    g.props[1] = { owner: bot.id, houses: 0, mortgaged: false };
    g.props[3] = { owner: bot.id, houses: 0, mortgaged: false };
    expect(decide(g, bot.id)).toEqual({ type: "mortgage", square: 1 });
    g.props[1] = { owner: bot.id, houses: 0, mortgaged: true };
    g.props[3] = { owner: bot.id, houses: 0, mortgaged: true };
    expect(decide(g, bot.id)).toEqual({ type: "bankrupt" });
  });

  test("turns down a trade offer right away, even on someone else's turn", () => {
    const { g, bot } = botTurn();
    g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
    act(
      g,
      "a",
      {
        type: "proposeTrade",
        to: bot.id,
        give: { squares: [], cash: 50, jailCards: 0 },
        get: { squares: [], cash: 0, jailCards: 0 },
      },
      () => 0,
    );
    const move = botMove(g);
    expect(move?.action.type).toBe("rejectTrade");
    act(g, move?.playerId as string, move?.action as never, () => 0);
    expect(g.trades).toHaveLength(0);
  });

  test("on its own turn it plays before answering offers, so offers can't stall it", () => {
    const { g, bot } = botTurn();
    g.trades = [
      {
        id: 1,
        from: "a",
        to: bot.id,
        give: { squares: [], cash: 50, jailCards: 0 },
        get: { squares: [], cash: 0, jailCards: 0 },
      },
    ];
    expect(decide(g, bot.id)).toEqual({ type: "roll" });
    g.turn = { playerId: bot.id, stage: "done", doubles: 0, rolledDoubles: false };
    expect(decide(g, bot.id)).toEqual({ type: "endTurn" });
  });

  test("a table of bots plays itself without a refused move", () => {
    const g = lobby(3);
    act(g, "a", { type: "start" }, () => 0);
    for (const p of g.players) p.bot = true;
    const rng = seeded(7);
    let moves = 0;
    while (g.phase === "playing" && moves < 5000) {
      const move = botMove(g);
      expect(move).not.toBe(null);
      if (!move) break;
      act(g, move.playerId, move.action, rng);
      moves++;
    }
    expect(moves).toBeGreaterThan(100);
  });
});

describe("the table alarm", () => {
  const now = 1_000_000;

  test("with nobody watching it only counts down to expiry, bots or not", () => {
    const idle = { sockets: 0, deadline: now + 5000, botAt: now + 100, now };
    expect(nextAlarm(idle)).toBe(now + EXPIRE_MS);
    expect(alarmTask({ ...idle, now: now + EXPIRE_MS })).toBe("expire");
  });

  test("wakes for whichever comes first, the bot move or the turn clock", () => {
    expect(nextAlarm({ sockets: 1, deadline: now + 60_000, botAt: now + 1000, now })).toBe(now + 1000);
    expect(nextAlarm({ sockets: 1, deadline: now + 500, botAt: now + 1000, now })).toBe(now + 500);
    expect(nextAlarm({ sockets: 1, deadline: null, botAt: null, now })).toBe(null);
  });

  test("plays a due bot move before a due clock, and waits when nothing is due", () => {
    expect(alarmTask({ sockets: 1, deadline: now, botAt: now, now })).toBe("bot");
    expect(alarmTask({ sockets: 1, deadline: now, botAt: now + 1000, now })).toBe("clock");
    expect(alarmTask({ sockets: 1, deadline: now + 5000, botAt: now + 1000, now })).toBe("wait");
  });

  test("a pending bot move keeps its time so other activity can't hold it back", () => {
    expect(nextBotAt(true, null, now)).toBe(now + BOT_DELAY_MS);
    expect(nextBotAt(true, now + 300, now)).toBe(now + 300);
    expect(nextBotAt(false, now + 300, now)).toBe(null);
    expect(nextBotAt(true, now - 60_000, now)).toBe(now + BOT_DELAY_MS);
  });
});
