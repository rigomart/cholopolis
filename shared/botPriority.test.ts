import { describe, expect, test } from "bun:test";

import { botMove } from "./bots.ts";
import { act, addPlayer, createGame, type Player } from "./game.ts";

function twoBots() {
  const g = createGame();
  addPlayer(g, "a", "Rosa");
  act(g, "a", { type: "addBot" }, () => 0);
  act(g, "a", { type: "addBot" }, () => 0);
  act(g, "a", { type: "start" }, () => 0);
  const [first, second] = g.players.filter((p) => p.bot) as [Player, Player];
  g.turn = { playerId: second.id, stage: "roll", doubles: 0, rolledDoubles: false };
  act(
    g,
    "a",
    {
      type: "proposeTrade",
      to: first.id,
      give: { squares: [], cash: 50, jailCards: 0 },
      get: { squares: [], cash: 0, jailCards: 0 },
    },
    () => 0,
  );
  return { g, first, second };
}

describe("bot move priority", () => {
  test.each([
    ["roll", "roll"],
    ["buy", "buy"],
    ["done", "endTurn"],
  ] as const)("a later bot's %s stage takes priority over an earlier bot's trade", (stage, action) => {
    const { g, second } = twoBots();
    second.position = 1;
    g.turn = { playerId: second.id, stage, doubles: 0, rolledDoubles: false };

    expect(botMove(g)).toEqual({ playerId: second.id, action: { type: action } });
  });

  test("a later bot settles debt before the earlier current bot rejects a trade", () => {
    const { g, first, second } = twoBots();
    g.turn = { playerId: first.id, stage: "roll", doubles: 0, rolledDoubles: false };
    second.cash = -10;
    g.props[1] = { owner: second.id, houses: 0, mortgaged: false };

    const move = botMove(g);
    expect(move).toEqual({ playerId: second.id, action: { type: "mortgage", square: 1 } });
    if (!move) throw new Error("Expected a bot move");
    act(g, move.playerId, move.action, () => 0);
    expect(second.cash).toBe(20);
    expect(botMove(g)).toEqual({ playerId: first.id, action: { type: "roll" } });
  });

  test("rejects an off-turn trade when no bot has a turn action or debt", () => {
    const { g, first } = twoBots();
    g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };

    const offer = g.trades[0];
    if (!offer) throw new Error("Expected a trade offer");
    const move = botMove(g);
    expect(move).toEqual({ playerId: first.id, action: { type: "rejectTrade", trade: offer.id } });
    if (!move) throw new Error("Expected a bot move");
    act(g, move.playerId, move.action, () => 0);
    expect(g.trades).toHaveLength(0);
  });
});
