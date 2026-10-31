import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { leaderboardKey, LeaderboardStore, type Sql } from "../worker/leaderboardStore.ts";
import { act, addPlayer, createGame, type GameState, type Player } from "./game.ts";
import {
  countsForRanking,
  finalPlacement,
  type GameRecord,
  gameRecord,
  placementPoints,
  RANKING_SIZE,
  scoreGame,
  standings,
  weekStart,
} from "./leaderboard.ts";

const START = Date.parse("2026-10-26T10:00:00-05:00");
const MINUTE = 60_000;
const rng = () => 0;

/** A started game with players a, b, c… in seat order; ids listed in `bots` are bots. */
function playing(count: number, bots: string[] = [], timeLimit: number | null = null): GameState {
  const g = createGame();
  const ids = "abcdefgh".slice(0, count).split("");
  for (const id of ids) addPlayer(g, id, id.toUpperCase());
  for (const id of bots) (g.players.find((x) => x.id === id) as Player).bot = true;
  g.timeLimit = timeLimit;
  act(g, "a", { type: "start" }, rng, START);
  g.players.sort((x, y) => x.id.localeCompare(y.id));
  g.turn = { playerId: "a", stage: "roll", doubles: 0, rolledDoubles: false };
  return g;
}

const p = (g: GameState, id: string) => g.players.find((x) => x.id === id) as Player;
const order = (g: GameState) => finalPlacement(g).map((x) => x.id);
const keysFor = (g: GameState) => Object.fromEntries(g.players.map((x) => [x.id, `key-${x.id}`]));

describe("placement", () => {
  test("bankruptcy end: the winner, then the bankrupt from the last to go out to the first", () => {
    const g = playing(4);
    for (const id of ["c", "a", "d"]) act(g, id, { type: "bankrupt" }, rng, START + MINUTE);
    expect(g.phase).toBe("ended");
    expect(order(g)).toEqual(["b", "d", "a", "c"]);
  });

  test("timed end: the net-worth ranking, then the bankrupt in reverse order of going out", () => {
    const g = playing(4, [], 30);
    act(g, "b", { type: "bankrupt" }, rng, START + MINUTE);
    p(g, "c").cash = 3000;
    p(g, "d").cash = 2000;
    p(g, "a").cash = 100;
    g.turn = { playerId: "a", stage: "done", doubles: 0, rolledDoubles: false };
    act(g, "a", { type: "endTurn" }, rng, START + 31 * MINUTE);
    expect(g.endedByTime).toBe(true);
    expect(g.winnerId).toBe("c");
    expect(order(g)).toEqual(["c", "d", "a", "b"]);
  });

  test("a rematch forgets who went out first", () => {
    const g = playing(2);
    act(g, "a", { type: "bankrupt" }, rng, START);
    act(g, "a", { type: "rematch" }, rng, START);
    expect(g.players.every((x) => x.outOrder === undefined)).toBe(true);
    expect(g.startedAt).toBeNull();
  });
});

describe("scoring", () => {
  test("1 point for finishing, plus 10 for each person behind you", () => {
    expect([1, 2, 3, 4].map((place) => placementPoints(4, place))).toEqual([31, 21, 11, 1]);
    expect([1, 2].map((place) => placementPoints(2, place))).toEqual([11, 1]);
  });

  test("bots earn nothing and don't count as people beaten; they don't hold people back either", () => {
    const placed = [{ id: "bot", bot: true }, { id: "a" }, { id: "bot2", bot: true }, { id: "b" }];
    expect(scoreGame(placed).map((s) => [s.player.id, s.points])).toEqual([
      ["a", 11],
      ["b", 1],
    ]);
  });

  test("one person against bots scores nothing", () => {
    expect(scoreGame([{ id: "a" }, { id: "bot", bot: true }])).toEqual([]);
  });

  test("standings add points, games and wins; a win is first place overall and breaks a tie on points", () => {
    const game = (id: string, ...players: [string | null, boolean][]): GameRecord => ({
      id,
      endedAt: START,
      ending: "bankruptcy",
      durationMs: 0,
      players: players.map(([key, bot], i) => ({ key, name: key ?? "Bot", bot, placement: i + 1, netWorth: 0 })),
    });
    const rows = standings([
      game("1", ["x", false], ["y", false]),
      game("2", [null, true], ["y", false], ["x", false]),
      game("3", ["x", false], [null, true]),
    ]);
    expect(rows).toEqual([
      { key: "x", points: 12, games: 2, wins: 1 },
      { key: "y", points: 12, games: 2, wins: 0 },
    ]);
  });
});

describe("what counts", () => {
  test("a finished game with two people counts; one person with bots doesn't", () => {
    const two = playing(3, ["c"]);
    act(two, "a", { type: "bankrupt" }, rng, START);
    act(two, "b", { type: "bankrupt" }, rng, START);
    expect(two.winnerId).toBe("c");
    expect(countsForRanking(two)).toBe(true);
    expect(scoreGame(finalPlacement(two)).map((s) => [s.player.id, s.points])).toEqual([
      ["b", 11],
      ["a", 1],
    ]);

    const solo = playing(3, ["b", "c"]);
    act(solo, "b", { type: "bankrupt" }, rng, START);
    act(solo, "c", { type: "bankrupt" }, rng, START);
    expect(solo.phase).toBe("ended");
    expect(countsForRanking(solo)).toBe(false);
  });

  test("a game still being played, or abandoned mid-game, has no record", () => {
    const g = playing(3);
    act(g, "a", { type: "bankrupt" }, rng, START);
    expect(countsForRanking(g)).toBe(false);
    expect(gameRecord(g, "room", keysFor(g), START)).toBeNull();
  });

  test("the record names people by leaderboard id and bots by nothing", () => {
    const g = playing(3, ["c"], 30);
    act(g, "a", { type: "bankrupt" }, rng, START + 10 * MINUTE);
    act(g, "b", { type: "bankrupt" }, rng, START + 12 * MINUTE);
    const record = gameRecord(g, "room", keysFor(g), START + 12 * MINUTE);
    expect(record).toMatchObject({ id: `room:${START}`, ending: "bankruptcy", durationMs: 12 * MINUTE });
    expect(record?.players.map(({ key, bot, placement }) => ({ key, bot, placement }))).toEqual([
      { key: null, bot: true, placement: 1 },
      { key: "key-b", bot: false, placement: 2 },
      { key: "key-a", bot: false, placement: 3 },
    ]);
  });
});

function memoryStore(): LeaderboardStore {
  const db = new Database(":memory:");
  const sql: Sql = {
    exec: <T>(query: string, ...bindings: (string | number | null)[]) => {
      const rows = db.query(query).all(...bindings) as T[];
      return { toArray: () => rows };
    },
  };
  return new LeaderboardStore(sql);
}

function finished(room: string, endedAt: number, keys: Record<string, string>, names?: Record<string, string>) {
  const g = playing(3);
  if (names) for (const [id, name] of Object.entries(names)) p(g, id).name = name;
  act(g, "c", { type: "bankrupt" }, rng, START);
  act(g, "b", { type: "bankrupt" }, rng, START);
  return gameRecord(g, room, keys, endedAt) as GameRecord;
}

describe("recording", () => {
  test("a game reported twice counts once, and a rematch is a new game", () => {
    const store = memoryStore();
    const keys = { a: "ka", b: "kb", c: "kc" };
    const game = finished("mesa", START + MINUTE, keys);
    expect(store.record(game)).toBe(true);
    expect(store.record(game)).toBe(false);
    expect(store.record({ ...game, endedAt: START + 5 * MINUTE })).toBe(false);
    const all = store.ranking("all", START + 2 * MINUTE, "ka");
    expect(all.rows.map((r) => [r.name, r.points, r.games, r.wins])).toEqual([
      ["A", 21, 1, 1],
      ["B", 11, 1, 0],
      ["C", 1, 1, 0],
    ]);
    expect(all.you).toEqual(all.rows[0] ?? null);

    const rematch = { ...finished("mesa", START + 20 * MINUTE, keys), id: `mesa:${START + 10 * MINUTE}` };
    expect(store.record(rematch)).toBe(true);
    expect(store.ranking("all", START + 21 * MINUTE, null).rows[0]).toMatchObject({ points: 42, games: 2 });
  });

  test("the name shown is the latest one that id played under", () => {
    const store = memoryStore();
    store.record(finished("uno", START + 2 * MINUTE, { a: "ka", b: "kb" }, { a: "Rosa" }));
    store.record(finished("dos", START + MINUTE, { a: "ka", b: "kb" }, { a: "Rosita vieja" }));
    expect(store.ranking("all", START + 3 * MINUTE, null).rows[0]?.name).toBe("Rosa");
  });

  test("the list stops at the top 50, and you still get your own row", () => {
    const store = memoryStore();
    for (let i = 0; i < RANKING_SIZE; i++) {
      store.record(finished(`m${i}`, START + i, { a: `w${i}`, b: `x${i}`, c: i === 0 ? "me" : `y${i}` }));
    }
    const view = store.ranking("all", START + MINUTE, "me");
    expect(view.rows).toHaveLength(RANKING_SIZE);
    expect(view.rows.some((r) => r.rank === view.you?.rank)).toBe(false);
    expect(view.you).toMatchObject({ points: 1, games: 1, wins: 0 });
    expect(view.you?.rank).toBeGreaterThan(RANKING_SIZE);
  });

  test("this week only counts games that ended since Monday in Lima", () => {
    const store = memoryStore();
    const monday = weekStart(START);
    store.record(finished("last-week", monday - 1, { a: "old", b: "kb" }));
    store.record(finished("this-week", monday, { a: "new", b: "kb" }));
    const week = store.ranking("week", START, null);
    expect(week.since).toBe(monday);
    expect(week.rows.map((r) => r.points)).toEqual([21, 11]);
    expect(store.ranking("all", START, null).rows).toHaveLength(3);
  });

  test("leaderboard ids are stable, distinct per token, and don't contain the token", async () => {
    const token = "abcdefghijklmnopqrstuvwx";
    const id = await leaderboardKey(token);
    expect(await leaderboardKey(token)).toBe(id);
    expect(await leaderboardKey(`${token}y`)).not.toBe(id);
    expect(id).not.toContain(token.slice(0, 8));
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("the week in Lima", () => {
  const lima = (iso: string) => Date.parse(`${iso}-05:00`);

  test("starts on Monday at midnight Lima time", () => {
    expect(weekStart(lima("2026-10-26T00:00:00"))).toBe(lima("2026-10-26T00:00:00"));
    expect(weekStart(lima("2026-10-28T13:30:00"))).toBe(lima("2026-10-26T00:00:00"));
  });

  test("Sunday 23:59 in Lima is still the same week, though it's Monday in UTC", () => {
    const sundayNight = lima("2026-11-01T23:59:59");
    expect(new Date(sundayNight).getUTCDay()).toBe(1);
    expect(weekStart(sundayNight)).toBe(lima("2026-10-26T00:00:00"));
    expect(weekStart(sundayNight + 1000)).toBe(lima("2026-11-02T00:00:00"));
  });

  test("a week crossing the new year", () => {
    expect(weekStart(lima("2027-01-01T12:00:00"))).toBe(lima("2026-12-28T00:00:00"));
  });
});
