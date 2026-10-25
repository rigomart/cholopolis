import { describe, expect, test } from "bun:test";

import { CARDS } from "../../../shared/cards.ts";
import {
  act,
  type Action,
  addPlayer,
  createGame,
  type GameState,
  type Player,
  type PublicState,
  toPublic,
} from "../../../shared/game.ts";
import { flowsAlong, flowsBetween, throughSalida } from "./flows.ts";

function dice(...faces: number[]) {
  const queue = faces.map((f) => (f - 1) / 6 + 0.01);
  return () => queue.shift() ?? 0;
}

function playing(count = 2): GameState {
  const g = createGame();
  const names = ["Ana", "Ana María", "Ana María José"];
  for (const [i, id] of ["a", "b", "c"].slice(0, count).entries()) addPlayer(g, id, names[i] ?? id);
  act(g, "a", { type: "start" }, () => 0);
  g.players.sort((x, y) => x.id.localeCompare(y.id));
  g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
  return g;
}

const p = (g: GameState, id: string) => g.players.find((x) => x.id === id) as Player;
const own = (g: GameState, id: string, ...squares: number[]) => {
  for (const s of squares) g.props[s] = { owner: id, houses: 0, mortgaged: false };
};

function flows(g: GameState, id: string, action: Action, rng = dice()) {
  const before: PublicState = structuredClone(toPublic(g));
  act(g, id, action, rng);
  return flowsBetween(before, toPublic(g));
}

describe("flowsBetween", () => {
  test("rent goes from the tenant to the owner", () => {
    const g = playing();
    own(g, "b", 3);
    expect(flows(g, "a", { type: "roll" }, dice(1, 2))).toEqual([{ from: "a", to: "b", amount: 4 }]);
  });

  test("passing Salida and paying rent in one roll stay separate", () => {
    const g = playing();
    own(g, "b", 1);
    p(g, "a").position = 38;
    expect(flows(g, "a", { type: "roll" }, dice(1, 2))).toEqual([
      { from: null, to: "a", amount: 200 },
      { from: "a", to: "b", amount: 2 },
    ]);
  });

  test("a roll past Salida splits at Salida without losing or repeating a flow", () => {
    const g = playing();
    own(g, "b", 1);
    p(g, "a").position = 38;
    const before: PublicState = structuredClone(toPublic(g));
    act(g, "a", { type: "roll" }, dice(1, 2));
    const after = toPublic(g);
    const mid = throughSalida(before, after);
    if (!mid) throw new Error("expected a Salida pass");
    expect(flowsBetween(before, mid)).toEqual([{ from: null, to: "a", amount: 200 }]);
    expect(flowsBetween(mid, after)).toEqual([{ from: "a", to: "b", amount: 2 }]);
    expect(throughSalida(mid, after)).toBeNull();
  });

  test("buying pays the bank", () => {
    const g = playing();
    act(g, "a", { type: "roll" }, dice(1, 2));
    expect(flows(g, "a", { type: "buy" })).toEqual([{ from: "a", to: null, amount: 60 }]);
  });

  test("a card that makes everyone pay yields one flow per payer", () => {
    const g = playing(3);
    g.decks.caja = [CARDS.caja.findIndex((c) => c.effect.type === "eachPlayer" && c.effect.amount === 50)];
    expect(flows(g, "a", { type: "roll" }, dice(1, 1))).toEqual([
      { from: "b", to: "a", amount: 50 },
      { from: "c", to: "a", amount: 50 },
    ]);
  });

  test("an accepted trade moves its cash between the two players", () => {
    const g = playing();
    own(g, "b", 3);
    const give = { squares: [], cash: 100, jailCards: 0 };
    const get = { squares: [3], cash: 0, jailCards: 0 };
    act(g, "a", { type: "proposeTrade", to: "b", give, get }, dice());
    const id = g.trades[0]?.id ?? 0;
    expect(flows(g, "b", { type: "acceptTrade", trade: id })).toEqual([{ from: "a", to: "b", amount: 100 }]);
  });

  test("going bankrupt in debt moves nothing, but the heir's building refund comes from the debtor", () => {
    const g = playing(3);
    own(g, "a", 1, 3);
    const street = g.props[3];
    if (street) street.houses = 2;
    Object.assign(p(g, "a"), { cash: -50, creditor: "b" });
    expect(flows(g, "a", { type: "bankrupt" })).toEqual([{ from: "a", to: "b", amount: 50 }]);
  });

  test("states released together are diffed pair by pair, so a wiped debt invents no payment", () => {
    const g = playing();
    own(g, "b", 3);
    p(g, "a").cash = 1;
    const start: PublicState = structuredClone(toPublic(g));
    act(g, "a", { type: "roll" }, dice(1, 2));
    const rolled: PublicState = structuredClone(toPublic(g));
    act(g, "a", { type: "bankrupt" }, dice());
    const broke = toPublic(g);
    expect(flowsAlong([start, rolled, broke])).toEqual([{ from: "a", to: "b", amount: 4 }]);
    expect(flowsBetween(start, broke)).toContainEqual({ from: null, to: "a", amount: 3 });
  });

  test("a player named like the bank is paid only when their cash says so", () => {
    const g = createGame();
    addPlayer(g, "a", "Ana");
    addPlayer(g, "b", "el banco");
    act(g, "a", { type: "start" }, () => 0);
    g.players.sort((x, y) => x.id.localeCompare(y.id));
    g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
    own(g, "b", 3);
    expect(flows(g, "a", { type: "roll" }, dice(1, 2))).toEqual([{ from: "a", to: "b", amount: 4 }]);
    g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
    p(g, "a").position = 0;
    expect(flows(g, "a", { type: "roll" }, dice(1, 3))).toEqual([{ from: "a", to: null, amount: 200 }]);
  });

  test("changes nobody logged settle with the bank", () => {
    const g = playing();
    own(g, "a", 1);
    expect(flows(g, "a", { type: "mortgage", square: 1 })).toEqual([{ from: null, to: "a", amount: 30 }]);
  });
});
