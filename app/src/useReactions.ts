import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { REACTION_COOLDOWN_MS, REACTION_SHOWN_MS, type ReactionId } from "../../shared/reactions.ts";
import { playReaction } from "./audio.ts";

/** What a player just said; `id` is new every time so the bubble restarts when they repeat themselves. */
export interface Bubble {
  id: number;
  reaction: ReactionId;
}

let lastBubbleId = 0;

export type Bubbles = Readonly<Record<string, Bubble>>;

/**
 * The reactions on screen, one bubble per player, each gone after `REACTION_SHOWN_MS`. `show` is for
 * reactions from the table and `react` is for yours: it sends, shows yours at once, and holds the
 * button for the cooldown. Nothing happens while the socket is down.
 */
export function useReactions(you: string | null, sendReaction: (reaction: ReactionId) => boolean) {
  const [bubbles, setBubbles] = useState<Bubbles>({});
  const [cooling, setCooling] = useState(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const show = useCallback((playerId: string, reaction: ReactionId) => {
    const bubble = { id: ++lastBubbleId, reaction };
    setBubbles((current) => ({ ...current, [playerId]: bubble }));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setBubbles((current) => {
        if (current[playerId]?.id !== bubble.id) return current;
        return Object.fromEntries(Object.entries(current).filter(([id]) => id !== playerId));
      });
    }, REACTION_SHOWN_MS);
    timers.current.add(timer);
    playReaction();
  }, []);

  const react = useCallback(
    (reaction: ReactionId) => {
      if (!you || cooling) return;
      if (!sendReaction(reaction)) return;
      show(you, reaction);
      setCooling(true);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setCooling(false);
      }, REACTION_COOLDOWN_MS);
      timers.current.add(timer);
    },
    [you, cooling, sendReaction, show],
  );

  return { bubbles, cooling, show, react };
}
