import { describe, expect, test } from "bun:test";

import { groupSquares } from "../../../shared/board.ts";
import { act, addPlayer, createGame, type GameState, type TradeSide } from "../../../shared/game.ts";
import {
  askableOwner,
  blockedReason,
  boardTap,
  clampCash,
  completions,
  counterDraft,
  groupProgress,
  sideValue,
  toggleSquare,
} from "./deal.ts";

const side = (squares: number[], cash = 0): TradeSide => ({ squares, cash, jailCards: 0 });

function table(): GameState {
  const g = createGame();
  for (const id of ["a", "b", "c"]) addPlayer(g, id, id.toUpperCase());
  act(g, "a", { type: "start" }, () => 0);
  const own = (i: number, owner: string) => {
    const p = g.props[i];
    if (p) p.owner = owner;
  };
  own(1, "a");
  own(6, "a");
  own(8, "a");
  own(9, "b");
  own(11, "b");
  own(13, "b");
  own(14, "a");
  own(5, "c");
  return g;
}

describe("deal summary", () => {
  test("the fixture's groups are where the tests expect them", () => {
    expect(groupSquares("celeste")).toEqual([6, 8, 9]);
    expect(groupSquares("rosa")).toEqual([11, 13, 14]);
    expect(groupSquares("cafe")).toEqual([1, 3]);
  });

  test("properties count at list price, at mortgage value while mortgaged, plus cash", () => {
    const g = table();
    expect(sideValue(g, side([1, 6], 50))).toBe(60 + 100 + 50);
    const p = g.props[6];
    if (p) p.mortgaged = true;
    expect(sideValue(g, side([1, 6], 50))).toBe(60 + 50 + 50);
    expect(sideValue(g, side([]))).toBe(0);
  });

  test("group progress counts what the owner holds of the group", () => {
    const g = table();
    expect(groupProgress(g, 6)).toBe("2/3 Celeste");
    expect(groupProgress(g, 9)).toBe("1/3 Celeste");
    expect(groupProgress(g, 5)).toBe("1/4 Transportes");
  });

  test("a card is blocked while its group has buildings", () => {
    const g = table();
    expect(blockedReason(g, 11)).toBeNull();
    const p = g.props[13];
    if (p) p.houses = 2;
    expect(blockedReason(g, 13)).toBe("tiene casas");
    expect(blockedReason(g, 11)).toBe("su grupo tiene casas");
    if (p) p.houses = 5;
    expect(blockedReason(g, 13)).toBe("tiene hotel");
    expect(blockedReason(g, 13, true)).toBeNull();
  });
});

describe("group completion badges", () => {
  test("asking for the last square of a group completes it for you", () => {
    const g = table();
    const done = completions(g, "a", "b", side([]), side([9]));
    expect(done.map((c) => [c.playerId, c.group.key])).toEqual([["a", "celeste"]]);
  });

  test("giving away the missing square completes it for the partner", () => {
    const g = table();
    const done = completions(g, "a", "b", side([14]), side([]));
    expect(done.map((c) => [c.playerId, c.group.key])).toEqual([["b", "rosa"]]);
  });

  test("both at once, yours first; a group already whole is not news", () => {
    const g = table();
    const done = completions(g, "a", "b", side([14]), side([9]));
    expect(done.map((c) => [c.playerId, c.group.key])).toEqual([
      ["a", "celeste"],
      ["b", "rosa"],
    ]);
    const p = g.props[3];
    if (p) p.owner = "a";
    expect(completions(g, "a", "b", side([]), side([]))).toEqual([]);
  });

  test("stations and services never earn a badge", () => {
    const g = table();
    for (const i of [15, 25, 35]) {
      const p = g.props[i];
      if (p) p.owner = "a";
    }
    expect(completions(g, "c", "a", side([5]), side([15, 25, 35]))).toEqual([]);
  });
});

describe("counter-offer", () => {
  test("swaps the sides so the composer reads from the one answering", () => {
    const draft = counterDraft({ id: 3, from: "b", to: "a", give: side([9], 150), get: side([1, 14]) });
    expect(draft).toEqual({ partner: "b", give: side([1, 14]), get: side([9], 150) });
  });
});

describe("board taps", () => {
  test("your square goes on your side, the partner's on theirs", () => {
    const g = table();
    expect(boardTap(g, "a", "b", 6)).toEqual({ to: "give" });
    expect(boardTap(g, "a", "b", 9)).toEqual({ to: "get" });
  });

  test("a third player's square switches the partner", () => {
    const g = table();
    expect(boardTap(g, "a", "b", 5)).toEqual({ to: "partner", partner: "c" });
  });

  test("unowned squares say so; corners and cards are ignored", () => {
    const g = table();
    expect(boardTap(g, "a", "b", 39)).toEqual({ to: "none", reason: "Malecón de Miraflores no tiene dueño." });
    expect(boardTap(g, "a", "b", 0)).toBeNull();
    expect(boardTap(g, "a", "b", 7)).toBeNull();
  });

  test("a bankrupt owner's square is ignored", () => {
    const g = table();
    const c = g.players.find((p) => p.id === "c");
    if (c) c.bankrupt = true;
    expect(boardTap(g, "a", "b", 5)).toBeNull();
  });
});

describe("editing a side", () => {
  test("toggling adds in board order and removes", () => {
    expect(toggleSquare(side([9]), 1).squares).toEqual([1, 9]);
    expect(toggleSquare(side([1, 9]), 1).squares).toEqual([9]);
  });

  test("cash stays between zero and what the owner holds", () => {
    expect(clampCash(550, 500)).toBe(500);
    expect(clampCash(-50, 500)).toBe(0);
    expect(clampCash(100, -20)).toBe(0);
  });
});

describe("Pedir from a deed", () => {
  test("asks the owner when it's someone else still playing", () => {
    const g = table();
    expect(askableOwner(g, "a", 9)).toBe("b");
    expect(askableOwner(g, "a", 6)).toBeNull();
    expect(askableOwner(g, "a", 39)).toBeNull();
    expect(askableOwner(g, null, 9)).toBeNull();
    const b = g.players.find((p) => p.id === "b");
    if (b) b.bankrupt = true;
    expect(askableOwner(g, "a", 9)).toBeNull();
  });
});
