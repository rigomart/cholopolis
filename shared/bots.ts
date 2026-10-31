import { isOwnable, square } from "./board.ts";
import { type Action, debtors, findPlayer, mortgageError, ownedBy, type PublicState, sellError } from "./game.ts";

/** Cash a bot keeps after buying a square. */
export const BOT_RESERVE = 260;

/**
 * What a bot would do next, or null when it has nothing to do: raise money or go bankrupt when in
 * debt, roll, buy what leaves it the reserve, end its turn, and turn down trades sent to it once
 * its turn is over (so a stream of offers can't stall it).
 */
export function decide(state: PublicState, me: string): Action | null {
  const p = findPlayer(state, me);
  if (!p || p.bankrupt || state.phase !== "playing") return null;
  if (p.cash < 0) {
    const owned = ownedBy(state, me);
    const sellable = owned.find((i) => sellError(state, me, i) === null);
    if (sellable !== undefined) return { type: "sell", square: sellable };
    const mortgageable = owned.find((i) => mortgageError(state, me, i) === null);
    return mortgageable !== undefined ? { type: "mortgage", square: mortgageable } : { type: "bankrupt" };
  }
  const offer = state.trades.find((t) => t.to === me);
  if (debtors(state).length > 0 || state.turn?.playerId !== me) {
    return offer ? { type: "rejectTrade", trade: offer.id } : null;
  }
  switch (state.turn.stage) {
    case "roll":
      return { type: "roll" };
    case "buy": {
      const sq = square(p.position);
      return isOwnable(sq) && p.cash - sq.price >= BOT_RESERVE ? { type: "buy" } : { type: "decline" };
    }
    case "done":
      return { type: "endTurn" };
  }
}

/** The next move any bot at the table would make, for the table to play on its behalf. */
export function botMove(state: PublicState): { playerId: string; action: Action } | null {
  for (const p of state.players) {
    if (!p.bot) continue;
    const action = decide(state, p.id);
    if (action) return { playerId: p.id, action };
  }
  return null;
}
