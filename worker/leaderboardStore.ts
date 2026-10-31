import {
  type GameRecord,
  RANKING_SIZE,
  type RankingPeriod,
  type RankingResponse,
  type RankRow,
  standings,
  weekStart,
} from "../shared/leaderboard.ts";

type SqlValue = string | number | null;

/** The part of Durable Object `SqlStorage` the store uses. */
export interface Sql {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): { toArray(): T[] };
}

interface ResultRow extends Record<string, SqlValue> {
  game_id: string;
  ended_at: number;
  ending: string;
  duration_ms: number;
  placement: number;
  player: string | null;
  name: string;
  bot: number;
  net_worth: number;
}

const RANKING_CACHE_MS = 30_000;

/** A leaderboard id for a browser token: one-way, so the token itself is never stored or shown. */
export async function leaderboardKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cholopolis-ranking:${token}`));
  return btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 16)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Raw per-game results, and the rankings computed from them. */
export class LeaderboardStore {
  private cache = new Map<RankingPeriod, { at: number; since: number | null; rows: ReturnType<typeof standings> }>();

  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      ended_at INTEGER NOT NULL,
      ending TEXT NOT NULL,
      duration_ms INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS results (
      game_id TEXT NOT NULL REFERENCES games(id),
      placement INTEGER NOT NULL,
      player TEXT,
      name TEXT NOT NULL,
      bot INTEGER NOT NULL,
      net_worth INTEGER NOT NULL,
      PRIMARY KEY (game_id, placement)
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS games_ended_at ON games(ended_at)");
    // The name each id last played under, derived from `results`.
    sql.exec(`CREATE TABLE IF NOT EXISTS players (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_at INTEGER NOT NULL
    )`);
  }

  /** Saves a finished game once; a game reported again is ignored. Returns whether it was new. */
  record(game: GameRecord): boolean {
    const inserted = this.sql
      .exec(
        "INSERT INTO games (id, ended_at, ending, duration_ms) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id",
        game.id,
        game.endedAt,
        game.ending,
        game.durationMs,
      )
      .toArray();
    if (inserted.length === 0) return false;
    for (const p of game.players) {
      this.sql.exec(
        "INSERT INTO results (game_id, placement, player, name, bot, net_worth) VALUES (?, ?, ?, ?, ?, ?)",
        game.id,
        p.placement,
        p.key,
        p.name,
        p.bot ? 1 : 0,
        p.netWorth,
      );
      if (!p.key) continue;
      this.sql.exec(
        `INSERT INTO players (key, name, last_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET name = excluded.name, last_at = excluded.last_at
         WHERE excluded.last_at >= players.last_at`,
        p.key,
        p.name,
        game.endedAt,
      );
    }
    this.cache.clear();
    return true;
  }

  /** Finished games that ended at or after `since`, players in placement order. */
  games(since: number | null): GameRecord[] {
    const rows = this.sql
      .exec<ResultRow>(
        `SELECT g.id AS game_id, g.ended_at, g.ending, g.duration_ms, r.placement, r.player, r.name, r.bot, r.net_worth
         FROM games g JOIN results r ON r.game_id = g.id
         WHERE g.ended_at >= ?
         ORDER BY g.ended_at, g.id, r.placement`,
        since ?? 0,
      )
      .toArray();
    const games = new Map<string, GameRecord>();
    for (const row of rows) {
      let game = games.get(row.game_id);
      if (!game) {
        game = {
          id: row.game_id,
          endedAt: row.ended_at,
          ending: row.ending === "time" ? "time" : "bankruptcy",
          durationMs: row.duration_ms,
          players: [],
        };
        games.set(row.game_id, game);
      }
      game.players.push({
        key: row.player,
        name: row.name,
        bot: row.bot === 1,
        placement: row.placement,
        netWorth: row.net_worth,
      });
    }
    return [...games.values()];
  }

  /** The top of the period, plus `you` (a leaderboard id) wherever you stand. */
  ranking(period: RankingPeriod, now: number, you: string | null): RankingResponse {
    const since = period === "week" ? weekStart(now) : null;
    let cached = this.cache.get(period);
    if (!cached || now - cached.at >= RANKING_CACHE_MS || cached.since !== since) {
      cached = { at: now, since, rows: standings(this.games(since)) };
      this.cache.set(period, cached);
    }
    const all = cached.rows;
    const top = all.slice(0, RANKING_SIZE);
    const yourIndex = you ? all.findIndex((s) => s.key === you) : -1;
    const shown = yourIndex >= RANKING_SIZE ? [...top, all[yourIndex]] : top;
    const names = this.names(shown.flatMap((s) => (s ? [s.key] : [])));
    const row = (i: number): RankRow | null => {
      const s = all[i];
      return s
        ? { rank: i + 1, name: names.get(s.key) ?? "Anónimo", points: s.points, games: s.games, wins: s.wins }
        : null;
    };
    return {
      period,
      since,
      rows: top.map((_, i) => row(i) as RankRow),
      you: yourIndex >= 0 ? row(yourIndex) : null,
    };
  }

  private names(keys: string[]): Map<string, string> {
    if (keys.length === 0) return new Map();
    const rows = this.sql
      .exec<{ key: string; name: string }>(
        `SELECT key, name FROM players WHERE key IN (${keys.map(() => "?").join(", ")})`,
        ...keys,
      )
      .toArray();
    return new Map(rows.map((r) => [r.key, r.name]));
  }
}
