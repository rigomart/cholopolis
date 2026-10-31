import type { ServerMessage } from "../shared/protocol.ts";
import { REACTION_COOLDOWN_MS, type ReactionId } from "../shared/reactions.ts";

/** Decides which reactions the table passes on. Nothing is stored: a dropped one is just gone. */
export class ReactionRelay {
  private readonly lastSent = new Map<string, number>();

  /**
   * The message to send the other sockets, or null when `playerId` isn't seated at this table
   * or already sent one within the cooldown. A seat is per player, so a second tab doesn't get its own.
   */
  accept(
    seats: readonly { id: string }[],
    playerId: string | null,
    reaction: ReactionId,
    now = Date.now(),
  ): ServerMessage | null {
    if (!playerId || !seats.some((p) => p.id === playerId)) return null;
    const last = this.lastSent.get(playerId);
    if (last !== undefined && now - last < REACTION_COOLDOWN_MS) return null;
    this.lastSent.set(playerId, now);
    return { type: "reaction", playerId, reaction };
  }
}
