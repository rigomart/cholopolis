import { netWorth, type Player, type PublicState, ranking } from "./game.ts";

/** One finished game as the leaderboard keeps it. Scores are computed from these, never stored. */
export interface GameRecord {
  /** The table's room and the game's start time, so a rematch is a new game. */
  id: string;
  endedAt: number;
  ending: "bankruptcy" | "time";
  durationMs: number;
  /** Everyone who played, winner first. */
  players: RecordedPlayer[];
}

export interface RecordedPlayer {
  /** Leaderboard id derived from the browser token; null for bots and for players with no known token. */
  key: string | null;
  name: string;
  bot: boolean;
  /** 1 is the winner. */
  placement: number;
  netWorth: number;
}

export interface RankRow {
  rank: number;
  name: string;
  points: number;
  games: number;
  wins: number;
}

export type RankingPeriod = "week" | "all";

export interface RankingResponse {
  period: RankingPeriod;
  /** Epoch ms the period starts; null for all time. */
  since: number | null;
  rows: RankRow[];
  /** Your own row, whether or not it made the list; null when you have no points in the period. */
  you: RankRow | null;
}

export const RANKING_SIZE = 50;
export const MIN_HUMANS = 2;
export const SCORING_RULE =
  "Cada partida terminada con al menos 2 personas da 1 punto, más 10 por cada persona que quedó detrás de ti. Los bots no suman.";

/**
 * Everyone in finishing order: the winner, the others still in by net worth, then the bankrupt
 * from the last to go out to the first.
 */
export function finalPlacement(g: PublicState): Player[] {
  const standing = ranking(g).map((r) => r.player);
  const out = g.players.filter((p) => p.bankrupt).sort((a, b) => (b.outOrder ?? 0) - (a.outOrder ?? 0));
  const order = [...standing, ...out];
  const winner = order.find((p) => p.id === g.winnerId);
  return winner ? [winner, ...order.filter((p) => p !== winner)] : order;
}

/** Whether a game adds to the leaderboard: finished, with a known start, and at least two people at the table. */
export function countsForRanking(g: PublicState): boolean {
  return g.phase === "ended" && g.startedAt !== null && g.players.filter((p) => !p.bot).length >= MIN_HUMANS;
}

export const gameId = (room: string, startedAt: number) => `${room}:${startedAt}`;

/** `keys` maps player ids to leaderboard ids. Null unless the game ended with a known start. */
export function gameRecord(
  g: PublicState,
  room: string,
  keys: Record<string, string>,
  endedAt: number,
): GameRecord | null {
  if (g.phase !== "ended" || g.startedAt === null) return null;
  return {
    id: gameId(room, g.startedAt),
    endedAt,
    ending: g.endedByTime ? "time" : "bankruptcy",
    durationMs: Math.max(0, endedAt - g.startedAt),
    players: finalPlacement(g).map((p, i) => ({
      key: p.bot ? null : (keys[p.id] ?? null),
      name: p.name,
      bot: Boolean(p.bot),
      placement: i + 1,
      netWorth: netWorth(g, p.id),
    })),
  };
}

/** Points for finishing `place` (1 is best) among `humans` people: 1, plus 10 for each person behind you. */
export function placementPoints(humans: number, place: number): number {
  return 1 + 10 * Math.max(0, humans - place);
}

export interface Scored<P> {
  player: P;
  points: number;
}

/** `placed` must be best first; returns the humans with their points, or nothing when the game doesn't count. */
export function scoreGame<P extends { bot?: boolean }>(placed: P[]): Scored<P>[] {
  const humans = placed.filter((p) => !p.bot);
  if (humans.length < MIN_HUMANS) return [];
  return humans.map((player, i) => ({ player, points: placementPoints(humans.length, i + 1) }));
}

export interface Standing {
  key: string;
  points: number;
  games: number;
  wins: number;
}

/** Totals per leaderboard id over `records`, best first: more points, then more wins, then fewer games. */
export function standings(records: GameRecord[]): Standing[] {
  const byKey = new Map<string, Standing>();
  for (const record of records) {
    for (const { player, points } of scoreGame(record.players)) {
      if (!player.key) continue;
      const s = byKey.get(player.key) ?? { key: player.key, points: 0, games: 0, wins: 0 };
      s.points += points;
      s.games += 1;
      if (player.placement === 1) s.wins += 1;
      byKey.set(player.key, s);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.points - a.points || b.wins - a.wins || a.games - b.games || a.key.localeCompare(b.key),
  );
}

const DAY_MS = 86_400_000;
/** Lima is UTC−5 all year. */
const LIMA_OFFSET_MS = -5 * 3_600_000;

/** Epoch ms of the Monday 00:00 in Lima that starts the week containing `now`. */
export function weekStart(now: number): number {
  const limaDay = Math.floor((now + LIMA_OFFSET_MS) / DAY_MS);
  // Day 0 (1970-01-01) was a Thursday, three days after a Monday.
  const monday = limaDay - ((limaDay + 3) % 7);
  return monday * DAY_MS - LIMA_OFFSET_MS;
}

export function parsePeriod(raw: string | null): RankingPeriod | null {
  return raw === "week" || raw === "all" ? raw : null;
}
