import { describe, expect, test } from "bun:test";

import { AWAY_MS, awaited, TURN_MS, turnLimit } from "./clock.ts";
import { act, addPlayer, createGame, type GameState, syncPresence } from "./game.ts";

function playing(): GameState {
  const g = createGame();
  for (const id of "abc") addPlayer(g, id, id.toUpperCase());
  act(g, "a", { type: "start" }, () => 0);
  g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
  return g;
}

const ids = (g: GameState) => awaited(g).map((p) => p.id);
const cash = (g: GameState, id: string, value: number) => {
  for (const p of g.players) if (p.id === id) p.cash = value;
};

describe("turn clock", () => {
  test("waits on the player whose turn it is, with the full turn while they're here", () => {
    const g = playing();
    expect(ids(g)).toEqual(["a"]);
    expect(turnLimit(g)).toBe(TURN_MS);
    syncPresence(g, new Set("bc"));
    expect(turnLimit(g)).toBe(AWAY_MS);
  });

  test("waits on whoever owes money instead, short only once every debtor is gone", () => {
    const g = playing();
    cash(g, "b", -50);
    cash(g, "c", -10);
    expect(ids(g)).toEqual(["b", "c"]);
    syncPresence(g, new Set("ac"));
    expect(turnLimit(g)).toBe(TURN_MS);
    syncPresence(g, new Set("a"));
    expect(turnLimit(g)).toBe(AWAY_MS);
  });
});
