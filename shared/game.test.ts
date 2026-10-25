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
  type GameState,
  GameError,
  type Player,
  rentFor,
  syncPresence,
} from "./game.ts";
import { parseClientMessage } from "./protocol.ts";

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
    const toss = { dice: [wild, wild] } as DiceToss;
    for (const jailed of [false, true]) {
      const plain = playing();
      const thrown = playing();
      p(plain, "a").inJail = p(thrown, "a").inJail = jailed;
      run(plain, "a", { type: "roll" }, dice(2, 2));
      run(thrown, "a", { type: "roll", toss }, dice(2, 2));
      expect(thrown.dice).toEqual([2, 2]);
      expect(thrown.players).toEqual(plain.players);
      expect(thrown.turn).toEqual(plain.turn);
      expect(thrown.toss?.dice[0].position).toEqual({ x: 4.2, y: 0.65, z: -4.2 });
      expect(thrown.toss?.dice[0].rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
      expect(thrown.toss?.dice[0].velocity).toEqual({ x: 0, y: 0, z: 20 });
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
    run(g, "a", { type: "roll", toss: { dice: [die, die] }, rollId: 0 }, dice(1, 1));
    expect(g.toss?.dice[1]).toEqual(die);
    if (g.turn?.stage === "buy") run(g, "a", { type: "decline" });
    expect(() => run(g, "a", { type: "roll", rollId: 0 })).toThrow("tiraste");
    autoPlay(g, dice(1, 2));
    expect(g.toss).toBeNull();
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
    expect(p(g, "a").creditor).toBe("b");
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

describe("protocol", () => {
  test("rejects malformed messages", () => {
    expect(parseClientMessage("nope")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "action", action: { type: "build", square: 99 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "action", action: { type: "hack" } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "join", name: "Ana" }))).toEqual({ type: "join", name: "Ana" });
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
