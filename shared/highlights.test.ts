import { describe, expect, test } from "bun:test";

import { addPlayer, createGame, type GameState } from "./game.ts";
import { highlights, place } from "./highlights.ts";
import { type PlayerStats, statsOf } from "./stats.ts";

function table(...ids: string[]): GameState {
  const g = createGame();
  for (const id of ids) addPlayer(g, id, id.toUpperCase());
  return g;
}

const set = (g: GameState, id: string, stats: Partial<PlayerStats>) => Object.assign(statsOf(g.stats, id), stats);
const lines = (g: GameState) => highlights(g).map((h) => `${h.playerId} ${h.text}`);

describe("highlights", () => {
  test("picks the stats furthest above their usual, worded for the postcard", () => {
    const g = table("a", "b");
    set(g, "a", { rentPaidAt: { 21: 300, 24: 4300 }, laps: 9, doubles: 2 });
    set(g, "b", { jailed: 3, purchases: 4 });
    expect(lines(g)).toEqual([
      "a pagó S/4,300 de alquiler en la Javier Prado",
      "b fue al Penal 3 veces",
      "a dio 9 vueltas al tablero",
    ]);
  });

  test("one of each kind and at most two per player", () => {
    const g = table("a", "b", "c");
    set(g, "a", { laps: 40, doubles: 30, purchases: 24 });
    set(g, "b", { laps: 32 });
    set(g, "c", { jailed: 1 });
    expect(lines(g)).toEqual(["a dio 40 vueltas al tablero", "a sacó dobles 30 veces", "c fue al Penal una vez"]);
  });

  test("ignores zeros and players without stats, and may return fewer", () => {
    const g = table("a", "b");
    set(g, "a", { laps: 1 });
    statsOf(g.stats, "b");
    expect(lines(g)).toEqual(["a dio 1 vuelta al tablero"]);
    expect(highlights(table("a"))).toEqual([]);
  });

  test("names squares the way people say them", () => {
    expect([1, 8, 16, 18, 5, 11, 15, 12, 28, 39].map(place)).toEqual([
      "la Grau",
      "la Universitaria",
      "la Av. El Sol",
      "la calle Mercaderes",
      "la Línea 1 del Metro",
      "el Jr. de la Unión",
      "el Metropolitano",
      "Luz del Sur",
      "Sedapal",
      "el Malecón de Miraflores",
    ]);
  });
});
