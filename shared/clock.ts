import { debtors, findPlayer, type Player, type PublicState } from "./game.ts";

/** Time to act when it's your move. */
export const TURN_MS = 60_000;
/** Time before the table plays for someone who is disconnected. */
export const AWAY_MS = 10_000;

/** Who the turn clock is waiting on: whoever owes money, or else the player whose turn it is. */
export function awaited(g: PublicState): Player[] {
  const owing = debtors(g);
  if (owing.length > 0) return owing;
  const current = findPlayer(g, g.turn?.playerId);
  return current ? [current] : [];
}

/**
 * How long the clock gives the awaited players: the full turn while any of them is connected,
 * less once all of them are gone. The server sets the deadline with this, and clients use it to
 * draw how much of the turn is left.
 */
export function turnLimit(g: PublicState): number {
  return awaited(g).some((p) => p.connected) ? TURN_MS : AWAY_MS;
}
