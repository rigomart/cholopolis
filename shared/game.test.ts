import { describe, expect, test } from "bun:test";

import { JAIL_SQUARE, STARTING_CASH } from "./board.ts";
import { CARDS } from "./cards.ts";
import type { DiceToss } from "./dice.ts";
import {
  act,
  type Action,
  addPlayer,
  autoPlay,
  buildError,
  canDragDice,
  createGame,
  debtsOf,
  type GameState,
  GameError,
  netWorth,
  type Player,
  ranking,
  rentFor,
  rematchHost,
  restoreGame,
  syncPresence,
} from "./game.ts";
import { parseClientMessage } from "./protocol.ts";
import { statsOf } from "./stats.ts";

/** An rng that replays dice faces (1–6), then keeps returning 0. */
function dice(...faces: number[]) {
  const queue = faces.map((f) => (f - 1) / 6 + 0.01);
  return () => queue.shift() ?? 0;
}

/** A started game with players a, b, c… in that turn order. */
function playing(count = 2): GameState {
  const g = createGame();
  const ids = "abcdefgh".slice(0, count).split("");
  for (const id of ids) addPlayer(g, id, id.toUpperCase());
  act(g, "a", { type: "start" }, () => 0);
  g.players.sort((x, y) => x.id.localeCompare(y.id));
  g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
  return g;
}

const p = (g: GameState, id: string) => g.players.find((x) => x.id === id) as Player;
const own = (g: GameState, id: string, ...squares: number[]) => {
  for (const s of squares) g.props[s] = { owner: id, houses: 0, mortgaged: false };
};
const run = (g: GameState, id: string, action: Action, rng = dice()) => act(g, id, action, rng);

describe("lobby", () => {
  test("names are cleaned and made unique", () => {
    const g = createGame();
    addPlayer(g, "a", "  Rosa  ");
    addPlayer(g, "b", "rosa");
    addPlayer(g, "c", "<b>\u0000");
    expect(g.players.map((x) => x.name)).toEqual(["Rosa", "rosa 2", "b"]);
    expect(g.hostId).toBe("a");
  });

  test("a full table frees a seat held by someone who left", () => {
    const g = createGame();
    for (const id of "abcdefgh") addPlayer(g, id, id);
    expect(() => addPlayer(g, "z", "z")).toThrow(GameError);
    syncPresence(g, new Set("abcdefg"));
    addPlayer(g, "z", "z");
    expect(g.players.map((x) => x.id)).not.toContain("h");
    expect(g.players).toHaveLength(8);
  });

  test("only the host starts, with at least two present", () => {
    const g = createGame();
    addPlayer(g, "a", "A");
    expect(() => act(g, "a", { type: "start" }, () => 0)).toThrow("al menos 2");
    addPlayer(g, "b", "B");
    expect(() => act(g, "b", { type: "start" }, () => 0)).toThrow("Solo quien abrió");
    act(g, "a", { type: "start" }, () => 0);
    expect(g.phase).toBe("playing");
    expect(g.decks.suerte).toHaveLength(CARDS.suerte.length);
  });

  test("everyone gets a different piece and can swap to a free one", () => {
    const g = createGame();
    for (const id of "abc") addPlayer(g, id, id);
    expect(new Set(g.players.map((x) => x.piece)).size).toBe(3);
    act(g, "a", { type: "choosePiece", piece: 7 }, () => 0);
    expect(g.players[0]?.piece).toBe(7);
    expect(() => act(g, "b", { type: "choosePiece", piece: 7 }, () => 0)).toThrow("ya tiene esa ficha");
  });

  test("pieces are fixed once the game starts", () => {
    const g = playing();
    expect(() => run(g, "a", { type: "choosePiece", piece: 5 })).toThrow("antes de empezar");
  });

  test("the host role moves to someone still connected", () => {
    const g = createGame();
    addPlayer(g, "a", "A");
    addPlayer(g, "b", "B");
    syncPresence(g, new Set(["b"]));
    expect(g.hostId).toBe("b");
  });
});

describe("turns", () => {
  test("cosmetic tosses cannot change RNG values, movement, or Penal doubles", () => {
    const wild = {
      position: { x: 999, y: -999, z: -999 },
      rotation: { x: 0, y: 0, z: 0, w: 5 },
      velocity: { x: 0, y: 0, z: 999 },
      spin: { x: 999, y: 0, z: 0 },
    };
    const toss = { dice: [wild, { ...wild, position: { x: -999, y: 999, z: 999 } }] } as DiceToss;
    for (const jailed of [false, true]) {
      const plain = playing();
      const thrown = playing();
      p(plain, "a").inJail = p(thrown, "a").inJail = jailed;
      run(plain, "a", { type: "roll" }, dice(2, 2));
      run(thrown, "a", { type: "roll", diceToss: toss }, dice(2, 2));
      expect(thrown.dice).toEqual([2, 2]);
      expect(thrown.players).toEqual(plain.players);
      expect(thrown.turn).toEqual(plain.turn);
      expect(thrown.diceToss?.dice[0].position).toEqual({ x: 4.08, y: 0.65, z: -4.08 });
      expect(thrown.diceToss?.dice[0].rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
      expect(thrown.diceToss?.dice[0].velocity).toEqual({ x: 0, y: 0, z: 20 });
      expect(thrown.rollId).toBe(1);
    }
  });

  test("button and automatic rolls clear the previous toss; stale rolls are refused", () => {
    const g = playing();
    const die = {
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 1, y: 1, z: 1 },
      spin: { x: 1, y: 1, z: 1 },
    };
    const other = { ...die, position: { x: 1, y: 1, z: 0 } };
    run(g, "a", { type: "roll", diceToss: { dice: [die, other] }, rollId: 0 }, dice(1, 1));
    expect(g.diceToss?.dice[1]).toEqual(other);
    if (g.turn?.stage === "buy") run(g, "a", { type: "decline" });
    expect(() => run(g, "a", { type: "roll", rollId: 0 })).toThrow("tiraste");
    autoPlay(g, dice(1, 2));
    expect(g.diceToss).toBeNull();
  });

  test("a toss that doesn't parse is dropped and the roll still happens", () => {
    for (const diceToss of [{ point: { x: 1, z: 1 } }, { dice: [] }, "junk"]) {
      const g = playing();
      run(g, "a", { type: "roll", diceToss: diceToss as unknown as DiceToss }, dice(3, 4));
      expect(g.dice).toEqual([3, 4]);
      expect(g.rollId).toBe(1);
      expect(g.diceToss).toBeNull();
    }
  });

  test("a game saved by an older version loads without its toss and plays on", () => {
    const die = {
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 1, y: 1, z: 1 },
      spin: { x: 1, y: 1, z: 1 },
    };
    const { diceToss: _, ...current } = playing();
    const legacy = {
      point: { x: -2.8, z: 3.15 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 2, z: -4 },
      spin: { x: 5, y: 1, z: -4 },
    };
    const old = { ...current, rollId: 7, dice: [3, 4], toss: legacy } as unknown as GameState;
    const g = restoreGame(structuredClone(old));
    expect("toss" in g).toBe(false);
    expect(g.diceToss).toBeNull();
    expect(g.dice).toEqual([3, 4]);
    run(g, "a", { type: "roll", rollId: 7 }, dice(1, 2));
    expect(g.rollId).toBe(8);

    const other = { ...die, position: { x: 1, y: 1, z: 0 } };
    expect(restoreGame({ ...g, diceToss: { dice: [die, "bad"] } } as unknown as GameState).diceToss).toBeNull();
    expect(restoreGame({ ...g, diceToss: { dice: [die, other] } }).diceToss).toEqual({ dice: [die, other] });
  });

  test("rolling moves the piece and offers an unowned street", () => {
    const g = playing();
    run(g, "a", { type: "roll" }, dice(1, 2));
    expect(p(g, "a").position).toBe(3);
    expect(g.turn?.stage).toBe("buy");
    run(g, "a", { type: "buy" });
    expect(g.props[3]?.owner).toBe("a");
    expect(p(g, "a").cash).toBe(STARTING_CASH - 60);
    expect(g.turn?.stage).toBe("done");
    run(g, "a", { type: "endTurn" });
    expect(g.turn?.playerId).toBe("b");
  });

  test("only the current player acts", () => {
    const g = playing();
    expect(() => run(g, "b", { type: "roll" })).toThrow("No es tu turno");
  });

  test("doubles roll again; three doubles go to the Penal", () => {
    const g = playing();
    run(g, "a", { type: "roll" }, dice(3, 3));
    run(g, "a", { type: "decline" });
    expect(g.turn?.stage).toBe("roll");
    run(g, "a", { type: "roll" }, dice(2, 2));
    expect(g.turn?.stage).toBe("roll");
    run(g, "a", { type: "roll" }, dice(1, 1));
    expect(p(g, "a").position).toBe(JAIL_SQUARE);
    expect(p(g, "a").inJail).toBe(true);
    expect(g.turn?.stage).toBe("done");
  });

  test("passing Salida pays the bonus", () => {
    const g = playing();
    p(g, "a").position = 38;
    run(g, "a", { type: "roll" }, dice(1, 2));
    expect(p(g, "a").position).toBe(1);
    expect(p(g, "a").cash).toBe(STARTING_CASH + 200);
  });

  test("the third failed jail roll pays the fine and moves", () => {
    const g = playing();
    Object.assign(p(g, "a"), { position: JAIL_SQUARE, inJail: true, jailTurns: 2 });
    run(g, "a", { type: "roll" }, dice(1, 3));
    expect(p(g, "a").inJail).toBe(false);
    expect(p(g, "a").position).toBe(14);
    expect(p(g, "a").cash).toBe(STARTING_CASH - 50);
  });

  test("doubles out of jail do not roll again", () => {
    const g = playing();
    Object.assign(p(g, "a"), { position: JAIL_SQUARE, inJail: true });
    own(g, "b", 14);
    run(g, "a", { type: "roll" }, dice(2, 2));
    expect(p(g, "a").inJail).toBe(false);
    expect(g.turn?.stage).toBe("done");
  });
});

describe("rent and buildings", () => {
  test("a full color group doubles the base rent, houses replace it", () => {
    const g = playing();
    own(g, "b", 1);
    expect(rentFor(g, 1, 7)).toBe(2);
    own(g, "b", 3);
    expect(rentFor(g, 1, 7)).toBe(4);
    g.props[1] = { owner: "b", houses: 2, mortgaged: false };
    expect(rentFor(g, 1, 7)).toBe(30);
  });

  test("stations and utilities scale with how many are owned", () => {
    const g = playing();
    own(g, "b", 5, 15);
    expect(rentFor(g, 5, 7)).toBe(50);
    own(g, "b", 12);
    expect(rentFor(g, 12, 7)).toBe(28);
    own(g, "b", 28);
    expect(rentFor(g, 12, 7)).toBe(70);
  });

  test("landing on someone's street pays them", () => {
    const g = playing();
    own(g, "b", 3);
    run(g, "a", { type: "roll" }, dice(1, 2));
    expect(p(g, "a").cash).toBe(STARTING_CASH - 4);
    expect(p(g, "b").cash).toBe(STARTING_CASH + 4);
  });

  test("building needs the whole group and goes evenly", () => {
    const g = playing();
    own(g, "a", 1);
    expect(buildError(g, "a", 1)).toContain("todo el grupo");
    own(g, "a", 3);
    run(g, "a", { type: "build", square: 1 });
    expect(buildError(g, "a", 1)).toContain("parejo");
    run(g, "a", { type: "build", square: 3 });
    run(g, "a", { type: "build", square: 1 });
    expect(g.props[1]?.houses).toBe(2);
    expect(p(g, "a").cash).toBe(STARTING_CASH - 150);
  });

  test("mortgaging needs the group cleared of buildings", () => {
    const g = playing();
    own(g, "a", 1, 3);
    run(g, "a", { type: "build", square: 1 });
    expect(() => run(g, "a", { type: "mortgage", square: 3 })).toThrow("vende los edificios");
    run(g, "a", { type: "sell", square: 1 });
    run(g, "a", { type: "mortgage", square: 3 });
    expect(p(g, "a").cash).toBe(STARTING_CASH - 50 + 25 + 30);
  });
});

function inDebt() {
  const g = playing(3);
  g.props[39] = { owner: "b", houses: 5, mortgaged: false };
  own(g, "a", 1);
  Object.assign(p(g, "a"), { position: 36, cash: 100 });
  run(g, "a", { type: "roll" }, dice(1, 2));
  return g;
}

describe("debts and bankruptcy", () => {
  test("an unpayable rent leaves the payer negative and blocks the turn", () => {
    const g = inDebt();
    expect(p(g, "a").cash).toBe(100 - 2000);
    expect(debtsOf(p(g, "a"))).toEqual([{ to: "b", amount: 1900 }]);
    expect(() => run(g, "a", { type: "endTurn" })).toThrow("saldar");
  });

  test("bankruptcy hands everything to the creditor and passes the turn", () => {
    const g = inDebt();
    run(g, "a", { type: "bankrupt" });
    expect(p(g, "a").bankrupt).toBe(true);
    expect(g.props[1]?.owner).toBe("b");
    expect(g.turn?.playerId).toBe("b");
  });

  test("the last player standing wins", () => {
    const g = playing(2);
    run(g, "a", { type: "bankrupt" });
    expect(g.phase).toBe("ended");
    expect(g.winnerId).toBe("b");
  });

  test("timing out sells and mortgages before declaring bankruptcy", () => {
    const g = playing();
    own(g, "a", 39);
    p(g, "a").cash = -100;
    autoPlay(g, dice());
    expect(g.props[39]?.mortgaged).toBe(true);
    expect(p(g, "a").cash).toBe(100);
    expect(p(g, "a").bankrupt).toBe(false);
  });

  test("timing out with nothing to sell goes bankrupt", () => {
    const g = playing(3);
    p(g, "b").cash = -10;
    autoPlay(g, dice());
    expect(p(g, "b").bankrupt).toBe(true);
    expect(g.turn?.playerId).toBe("a");
  });
});

describe("unpaid debts are not money", () => {
  test("bankruptcy leaves the creditor only what the debtor really had", () => {
    const g = inDebt();
    run(g, "a", { type: "bankrupt" });
    expect(p(g, "b").cash).toBe(STARTING_CASH + 100);
  });

  test("a card payer who runs out midway owes each player only what was left unpaid", () => {
    const g = playing(4);
    own(g, "a", 1);
    const junta = CARDS.suerte.findIndex((c) => c.text.includes("junta de vecinos"));
    g.decks.suerte = [junta];
    Object.assign(p(g, "a"), { position: 0, cash: 20 });
    run(g, "a", { type: "roll" }, dice(3, 4));
    expect(p(g, "a").cash).toBe(20 - 150);
    run(g, "a", { type: "bankrupt" });
    expect(p(g, "b").cash).toBe(STARTING_CASH + 20);
    expect(p(g, "c").cash).toBe(STARTING_CASH);
    expect(p(g, "d").cash).toBe(STARTING_CASH);
    expect(g.props[1]?.owner).toBe("c");
  });

  test("cash raised after a debt clears the oldest debts first", () => {
    const g = playing(4);
    own(g, "a", 1);
    const junta = CARDS.suerte.findIndex((c) => c.text.includes("junta de vecinos"));
    g.decks.suerte = [junta];
    Object.assign(p(g, "a"), { position: 0, cash: 20 });
    run(g, "a", { type: "roll" }, dice(3, 4));
    p(g, "a").cash = -30;
    run(g, "a", { type: "bankrupt" });
    expect(p(g, "b").cash).toBe(STARTING_CASH + 50);
    expect(p(g, "c").cash).toBe(STARTING_CASH + 50);
    expect(p(g, "d").cash).toBe(STARTING_CASH + 20);
    expect(g.props[1]?.owner).toBe("d");
  });

  test("a creditor cannot spend the part of a payment the debtor never had", () => {
    const g = inDebt();
    const give = { squares: [], cash: STARTING_CASH + 101, jailCards: 0 };
    const none = { squares: [], cash: 0, jailCards: 0 };
    expect(() => run(g, "b", { type: "proposeTrade", to: "c", give, get: none })).toThrow("no tiene");
    run(g, "b", { type: "proposeTrade", to: "c", give: { ...give, cash: STARTING_CASH + 100 }, get: none });
  });

  test("a debt to the bank sends the properties back to the market", () => {
    const g = playing(3);
    own(g, "a", 1);
    Object.assign(p(g, "a"), { position: 0, cash: 50 });
    run(g, "a", { type: "roll" }, dice(2, 2));
    expect(p(g, "a").cash).toBeLessThan(0);
    run(g, "a", { type: "bankrupt" });
    expect(g.props[1]?.owner).toBeNull();
  });
});

test("a game saved before debts were tracked per creditor keeps who it owed", () => {
  const g = playing(3);
  p(g, "a").cash = -50;
  const saved = structuredClone(g) as unknown as { players: Record<string, unknown>[] };
  const old = saved.players[0] as Record<string, unknown>;
  Object.assign(old, { creditor: "c" });
  delete old.debts;
  delete old.idleTurns;
  const restored = restoreGame(saved as unknown as GameState);
  expect(debtsOf(p(restored, "a"))).toEqual([{ to: "c", amount: 50 }]);
  expect(p(restored, "a").idleTurns).toBe(0);
});

/** Lets `a` time out through one whole turn while the others stay connected. */
function timeOutTurn(g: GameState) {
  g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
  for (let i = 0; i < 20 && g.turn?.playerId === "a" && !p(g, "a").bankrupt; i++) autoPlay(g, dice(1, 2, 1, 2));
}

describe("disconnected players", () => {
  test("three timed-out turns away forfeit the seat to the bank", () => {
    const g = playing(3);
    own(g, "a", 39);
    syncPresence(g, new Set(["b", "c"]));
    timeOutTurn(g);
    timeOutTurn(g);
    expect(p(g, "a").bankrupt).toBe(false);
    timeOutTurn(g);
    expect(p(g, "a").bankrupt).toBe(true);
    expect(g.props[39]?.owner).toBeNull();
    expect(g.log.at(-1)?.text ?? "").not.toBe("");
    expect(g.turn?.playerId).not.toBe("a");
  });

  test("the table does not play the turn of a seat it is giving up", () => {
    const g = playing(3);
    syncPresence(g, new Set(["b", "c"]));
    timeOutTurn(g);
    timeOutTurn(g);
    g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
    const rollId = g.rollId;
    autoPlay(g, dice(1, 2));
    expect(p(g, "a").bankrupt).toBe(true);
    expect(g.rollId).toBe(rollId);
  });

  test("coming back resets the count", () => {
    const g = playing(3);
    syncPresence(g, new Set(["b", "c"]));
    timeOutTurn(g);
    timeOutTurn(g);
    syncPresence(g, new Set(["a", "b", "c"]));
    syncPresence(g, new Set(["b", "c"]));
    timeOutTurn(g);
    timeOutTurn(g);
    expect(p(g, "a").bankrupt).toBe(false);
  });

  test("a connected player who keeps timing out stays in", () => {
    const g = playing(3);
    for (let i = 0; i < 5; i++) timeOutTurn(g);
    expect(p(g, "a").bankrupt).toBe(false);
  });

  test("the last player left after a forfeit wins", () => {
    const g = playing(2);
    syncPresence(g, new Set(["b"]));
    for (let i = 0; i < 3; i++) timeOutTurn(g);
    expect(g.phase).toBe("ended");
    expect(g.winnerId).toBe("b");
  });
});

describe("cards", () => {
  test("a birthday collects from every other player", () => {
    const g = playing(3);
    const birthday = CARDS.caja.findIndex((c) => c.text.includes("cumpleaños"));
    g.decks.caja = [birthday];
    run(g, "a", { type: "roll" }, dice(1, 1));
    expect(p(g, "a").cash).toBe(STARTING_CASH + 20);
    expect(p(g, "b").cash).toBe(STARTING_CASH - 10);
    expect(g.card?.text).toContain("cumpleaños");
  });

  test("a jail card leaves the deck until it is used", () => {
    const g = playing();
    const jailCard = CARDS.caja.findIndex((c) => c.effect.type === "jailCard");
    g.decks.caja = [jailCard, 0];
    run(g, "a", { type: "roll" }, dice(1, 1));
    expect(p(g, "a").jailCards).toEqual(["caja"]);
    expect(g.decks.caja).toEqual([0]);
    Object.assign(p(g, "a"), { inJail: true, position: JAIL_SQUARE });
    g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
    run(g, "a", { type: "useJailCard" });
    expect(p(g, "a").inJail).toBe(false);
    expect(g.decks.caja).toEqual([0, jailCard]);
  });
});

describe("trades", () => {
  test("an accepted trade swaps properties and cash", () => {
    const g = playing();
    own(g, "a", 1);
    own(g, "b", 3);
    const give = { squares: [1], cash: 50, jailCards: 0 };
    const get = { squares: [3], cash: 0, jailCards: 0 };
    run(g, "a", { type: "proposeTrade", to: "b", give, get });
    const id = g.trades[0]?.id ?? -1;
    run(g, "b", { type: "acceptTrade", trade: id });
    expect(g.props[1]?.owner).toBe("b");
    expect(g.props[3]?.owner).toBe("a");
    expect(p(g, "b").cash).toBe(STARTING_CASH + 50);
    expect(g.trades).toHaveLength(0);
  });

  test("a trade cannot offer what you do not own", () => {
    const g = playing();
    const side = { squares: [1], cash: 0, jailCards: 0 };
    expect(() => run(g, "a", { type: "proposeTrade", to: "b", give: side, get: side })).toThrow("no es de");
  });
});

const MINUTE = 60_000;
const START = 1_000_000;
const LATE = START + 31 * MINUTE;

/** A game of `minutes` started at START with players a, b, c… in that turn order, a's turn done. */
function timed(minutes: number | null, count = 2): GameState {
  const g = createGame();
  for (const id of "abcdefgh".slice(0, count)) addPlayer(g, id, id.toUpperCase());
  act(g, "a", { type: "setTimeLimit", minutes }, () => 0);
  act(g, "a", { type: "start" }, () => 0, START);
  g.players.sort((x, y) => x.id.localeCompare(y.id));
  g.turn = { playerId: "a", stage: "done", doubles: 0, rolledDoubles: false };
  return g;
}

describe("net worth", () => {
  test("counts cash, property prices, mortgage values and buildings", () => {
    const g = playing();
    expect(netWorth(g, "a")).toBe(STARTING_CASH);
    own(g, "a", 1, 3, 5, 6);
    const [grau, abancay, metro] = [g.props[1], g.props[3], g.props[5]];
    if (grau) grau.houses = 2;
    if (abancay) abancay.houses = 5;
    if (metro) metro.mortgaged = true;
    expect(netWorth(g, "a")).toBe(STARTING_CASH + (60 + 2 * 50) + (60 + 5 * 50) + 100 + 100);
  });

  test("a debt counts against it, and an unknown player has none", () => {
    const g = playing();
    p(g, "a").cash = -75;
    expect(netWorth(g, "a")).toBe(-75);
    expect(netWorth(g, "nobody")).toBe(0);
  });

  test("ranks players still in the game, richest first, ties by cash then seat", () => {
    const g = playing(4);
    own(g, "a", 1);
    p(g, "a").cash = 100;
    p(g, "b").cash = 160;
    p(g, "c").cash = 160;
    p(g, "d").bankrupt = true;
    expect(ranking(g).map((r) => [r.player.id, r.worth])).toEqual([
      ["b", 160],
      ["c", 160],
      ["a", 160],
    ]);
    p(g, "c").cash = 161;
    expect(ranking(g).map((r) => r.player.id)).toEqual(["c", "b", "a"]);
  });
});

describe("timed games", () => {
  test("only the host picks one of the offered lengths, and only in the lobby", () => {
    const g = createGame();
    addPlayer(g, "a", "A");
    addPlayer(g, "b", "B");
    expect(g.timeLimit).toBeNull();
    expect(() => run(g, "b", { type: "setTimeLimit", minutes: 30 })).toThrow("quien abrió la mesa");
    expect(() => run(g, "a", { type: "setTimeLimit", minutes: 20 })).toThrow("no existe");
    for (const minutes of [30, 45, 60, null]) {
      run(g, "a", { type: "setTimeLimit", minutes });
      expect(g.timeLimit).toBe(minutes);
    }
    run(g, "a", { type: "start" });
    expect(() => run(g, "a", { type: "setTimeLimit", minutes: 30 })).toThrow("antes de empezar");
  });

  test("the countdown starts with the game", () => {
    expect(timed(45).endsAt).toBe(START + 45 * MINUTE);
    expect(timed(null).endsAt).toBeNull();
  });

  test("before the time is up, a turn change goes on as usual", () => {
    const g = timed(30);
    act(g, "a", { type: "endTurn" }, dice(), START + 29 * MINUTE);
    expect(g.phase).toBe("playing");
    expect(g.turn?.playerId).toBe("b");
  });

  test("time running out waits for the turn to end, then the richest player wins", () => {
    const g = timed(30, 3);
    own(g, "a", 6);
    own(g, "c", 1, 3);
    p(g, "c").cash += 200;
    act(g, "a", { type: "mortgage", square: 6 }, dice(), LATE);
    expect(g.phase).toBe("playing");
    act(g, "a", { type: "endTurn" }, dice(), LATE);
    expect(g.phase).toBe("ended");
    expect(g.endedByTime).toBe(true);
    expect(g.winnerId).toBe("c");
    expect(g.turn).toBeNull();
    expect(g.log.at(-1)?.text).toContain("Se acabó el tiempo");
  });

  test("a turn change while someone owes money does not end it; the next one after they pay does", () => {
    const g = timed(30, 4);
    p(g, "c").cash = -5;
    act(g, "a", { type: "bankrupt" }, dice(), LATE);
    expect(g.phase).toBe("playing");
    expect(g.turn?.playerId).toBe("b");
    p(g, "c").cash = 0;
    g.turn = { playerId: "b", stage: "done", doubles: 0, rolledDoubles: false };
    act(g, "b", { type: "endTurn" }, dice(), LATE);
    expect(g.phase).toBe("ended");
    expect(g.endedByTime).toBe(true);
  });

  test("rolling doubles after time is up is still the same turn", () => {
    const g = timed(30);
    g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
    act(g, "a", { type: "roll" }, dice(3, 3), LATE);
    expect(g.phase).toBe("playing");
    expect(g.turn?.playerId).toBe("a");
    expect(g.turn?.stage).not.toBe("done");
  });

  test("a turn played by the timeout also ends it", () => {
    const g = timed(30);
    autoPlay(g, dice(), LATE);
    expect(g.phase).toBe("ended");
    expect(g.endedByTime).toBe(true);
  });

  test("bankruptcy still ends it first, and a game without a limit or a clock never times out", () => {
    const bust = timed(30);
    act(bust, "a", { type: "bankrupt" }, dice(), LATE);
    expect(bust.winnerId).toBe("b");
    expect(bust.endedByTime).toBe(false);

    const untimed = timed(null);
    act(untimed, "a", { type: "endTurn" }, dice(), LATE * 100);
    expect(untimed.phase).toBe("playing");

    const noClock = timed(30);
    act(noClock, "a", { type: "endTurn" }, dice());
    expect(noClock.phase).toBe("playing");
  });

  test("games saved before timed games load as untimed", () => {
    const { timeLimit: _a, endsAt: _b, endedByTime: _c, ...old } = timed(null);
    const g = restoreGame(old as unknown as GameState);
    expect([g.timeLimit, g.endsAt, g.endedByTime]).toEqual([null, null, false]);
  });
});

/** A game of three that ran out of time, with b's and c's pieces and some state worth resetting. */
function over(): GameState {
  const g = timed(30, 3);
  p(g, "b").piece = 4;
  own(g, "b", 1, 3);
  p(g, "b").cash = 123;
  p(g, "b").debts = [{ to: "a", amount: 5 }];
  Object.assign(p(g, "c"), {
    position: JAIL_SQUARE,
    inJail: true,
    jailCards: ["caja" as const],
    bankrupt: true,
    idleTurns: 2,
  });
  g.trades.push({
    id: 99,
    from: "a",
    to: "b",
    give: { squares: [], cash: 1, jailCards: 0 },
    get: { squares: [], cash: 0, jailCards: 0 },
  });
  act(g, "a", { type: "endTurn" }, dice(), LATE);
  return g;
}

describe("rematch", () => {
  test("goes back to the lobby with the same seats, pieces, colors, host and length, and fresh cash and board", () => {
    const g = over();
    const seats = g.players.map(({ id, name, color, piece }) => ({ id, name, color, piece }));
    const nextId = g.nextId;
    run(g, "a", { type: "rematch" });
    expect(g.phase).toBe("lobby");
    expect(g.players.map(({ id, name, color, piece }) => ({ id, name, color, piece }))).toEqual(seats);
    expect(g.hostId).toBe("a");
    expect(g.timeLimit).toBe(30);
    expect([g.endsAt, g.winnerId, g.turn, g.dice, g.deadline, g.endedByTime]).toEqual([
      null,
      null,
      null,
      null,
      null,
      false,
    ]);
    expect(g.trades).toEqual([]);
    expect(g.props.every((x) => x === null || (x.owner === null && x.houses === 0 && !x.mortgaged))).toBe(true);
    for (const player of g.players) {
      expect(player).toMatchObject({
        cash: STARTING_CASH,
        position: 0,
        inJail: false,
        jailCards: [],
        bankrupt: false,
        debts: [],
        idleTurns: 0,
      });
    }
    expect(g.nextId).toBeGreaterThan(nextId);
    expect(g.log.at(-1)?.text).toBe("A pidió la revancha.");
    expect(g.log.some((e) => e.text.includes("Se acabó el tiempo"))).toBe(true);
  });

  test("the new game starts from the lobby like any other, with spectators able to sit", () => {
    const g = over();
    run(g, "a", { type: "rematch" });
    addPlayer(g, "z", "Z");
    expect(g.players).toHaveLength(4);
    act(g, "a", { type: "start" }, dice(), START);
    expect(g.phase).toBe("playing");
    expect(g.endsAt).toBe(START + 30 * MINUTE);
  });

  test("players who left lose their seat", () => {
    const g = over();
    syncPresence(g, new Set(["a", "b"]));
    run(g, "a", { type: "rematch" });
    expect(g.players.map((x) => x.id)).toEqual(["a", "b"]);
    expect(g.log.some((e) => e.text === "C se fue.")).toBe(true);
  });

  test("the host asks, or the first present player when the host is gone", () => {
    const g = over();
    syncPresence(g, new Set(["b", "c"]));
    expect(() => run(g, "c", { type: "rematch" })).toThrow("quien abrió la mesa");
    expect(() => run(g, "a", { type: "rematch" })).toThrow("quien abrió la mesa");
    run(g, "b", { type: "rematch" });
    expect(g.hostId).toBe("b");
    expect(g.players.map((x) => x.id)).toEqual(["b", "c"]);
  });

  test("bots keep their seats and never ask for it", () => {
    const g = timed(30, 3);
    const bot = p(g, "c");
    bot.bot = true;
    syncPresence(g, new Set(["a"]));
    expect(rematchHost(g)?.id).toBe("a");
    act(g, "a", { type: "endTurn" }, dice(), LATE);
    syncPresence(g, new Set(["b"]));
    expect(g.players.find((x) => x.id === "a")?.connected).toBe(false);
    expect(rematchHost(g)?.id).toBe("b");
    expect(() => run(g, "c", { type: "rematch" })).toThrow("quien abrió la mesa");
    run(g, "b", { type: "rematch" });
    expect(g.players.map((x) => [x.id, x.bot ?? false])).toEqual([
      ["b", false],
      ["c", true],
    ]);
    expect(g.hostId).toBe("b");
  });

  test("only after a game has ended", () => {
    const g = timed(null);
    expect(() => run(g, "a", { type: "rematch" })).toThrow("cuando termina");
    const lobby = createGame();
    addPlayer(lobby, "a", "A");
    expect(() => run(lobby, "a", { type: "rematch" })).toThrow(GameError);
  });
});

const action = (a: unknown) => parseClientMessage(JSON.stringify({ type: "action", action: a }));

describe("protocol", () => {
  test("rejects malformed messages", () => {
    expect(parseClientMessage("nope")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "action", action: { type: "build", square: 99 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "action", action: { type: "hack" } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "join", name: "Ana" }))).toEqual({ type: "join", name: "Ana" });
  });

  test("accepts the rematch and time limit actions, and rejects a malformed limit", () => {
    expect(action({ type: "rematch" })).toEqual({ type: "action", action: { type: "rematch" } });
    expect(action({ type: "setTimeLimit", minutes: 45 })).toEqual({
      type: "action",
      action: { type: "setTimeLimit", minutes: 45 },
    });
    expect(action({ type: "setTimeLimit", minutes: null })).toEqual({
      type: "action",
      action: { type: "setTimeLimit", minutes: null },
    });
    expect(action({ type: "setTimeLimit", minutes: "45" })).toBeNull();
    expect(action({ type: "setTimeLimit" })).toBeNull();
  });
});

test("only a connected current player at this roll can drag, including in the Penal", () => {
  const g = playing();
  expect(canDragDice(g, "a", 0)).toBe(true);
  p(g, "a").inJail = true;
  expect(canDragDice(g, "a", 0)).toBe(true);
  expect(canDragDice(g, "b", 0)).toBe(false);
  expect(canDragDice(g, null, 0)).toBe(false);
  expect(canDragDice(g, "a", 1)).toBe(false);
  p(g, "b").cash = -1;
  expect(canDragDice(g, "a", 0)).toBe(false);
  p(g, "b").cash = 0;
  p(g, "a").connected = false;
  expect(canDragDice(g, "a", 0)).toBe(false);
  p(g, "a").connected = true;
  if (g.turn) g.turn.stage = "done";
  expect(canDragDice(g, "a", 0)).toBe(false);
});

const stats = (g: GameState, id: string) => g.stats[id];

describe("postcard stats", () => {
  test("rent is counted for the payer and the owner, by square", () => {
    const g = inDebt();
    expect(stats(g, "a")).toMatchObject({ rentPaid: 2000, rentPaidAt: { 39: 2000 }, biggestPayment: 2000 });
    expect(stats(g, "b")).toMatchObject({ rentReceived: 2000, rentReceivedAt: { 39: 2000 } });
    run(g, "a", { type: "bankrupt" });
    expect(stats(g, "b")?.knockouts).toBe(1);
  });

  test("a mortgaged square charges no rent and counts none", () => {
    const g = playing();
    g.props[3] = { owner: "b", houses: 0, mortgaged: true };
    run(g, "a", { type: "roll" }, dice(1, 2));
    expect(stats(g, "a")?.rentPaid ?? 0).toBe(0);
  });

  test("laps, doubles, purchases, buildings, the Penal and the bank", () => {
    const g = playing();
    p(g, "a").position = 36;
    run(g, "a", { type: "roll" }, dice(2, 2));
    run(g, "a", { type: "roll" }, dice(1, 2));
    run(g, "a", { type: "buy" });
    own(g, "a", 1);
    run(g, "a", { type: "build", square: 1 });
    expect(stats(g, "a")).toMatchObject({ laps: 1, doubles: 1, purchases: 1, built: 1 });

    run(g, "a", { type: "endTurn" });
    p(g, "b").position = 27;
    run(g, "b", { type: "roll" }, dice(1, 2));
    run(g, "b", { type: "endTurn" });
    expect(stats(g, "b")?.jailed).toBe(1);

    run(g, "a", { type: "roll" }, dice(4, 5));
    expect(p(g, "a").position).toBe(12);
    if (g.turn) g.turn.stage = "done";
    run(g, "a", { type: "endTurn" });
    run(g, "b", { type: "payJailFine" });
    expect(stats(g, "b")).toMatchObject({ paidToBank: 50, biggestPayment: 50 });
  });

  test("rematch clears them and older saves load with none", () => {
    const g = over();
    statsOf(g.stats, "a").laps = 4;
    run(g, "a", { type: "rematch" });
    expect(g.stats).toEqual({});
    const { stats: _stats, ...old } = playing();
    expect(restoreGame(old as GameState).stats).toEqual({});
  });
});
