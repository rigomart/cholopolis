import { useEffect, useState } from "preact/hooks";

import { PLAYER_COLORS, type Player } from "../../../shared/game.ts";
import { pieceThumbnail } from "../scene/thumbnails.ts";

/** The player's token as rendered on the board, or a pawn in their color when 3D is unavailable. */
export function Pawn({ player, size = 18 }: { player: Pick<Player, "color" | "piece">; size?: number }) {
  const src = pieceThumbnail(player.piece ?? player.color, player.color);
  if (src) return <img class="pawn piece-thumb" src={src} width={size * 1.7} height={size * 1.7} alt="" />;
  return (
    <svg class="pawn" width={size} height={size * 1.3} viewBox="0 0 20 26" aria-hidden="true">
      <path
        d="M10 1a4 4 0 0 1 2.6 7l1.9 1.2v1.6h-2.2l1.2 7.2 4 2.2V24H2.5v-3.8l4-2.2 1.2-7.2H5.5V9.2L7.4 8A4 4 0 0 1 10 1Z"
        fill={PLAYER_COLORS[player.color] ?? "#fff"}
        stroke="#1b1240"
        stroke-width="1.4"
      />
    </svg>
  );
}

/** Re-renders every `ms` while `active`, for countdowns. */
export function useNow(active: boolean, ms = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <h1 class={small ? "wordmark wordmark-small" : "wordmark"} aria-label="Cholopolis">
      <span aria-hidden="true" data-text="CHOLOPOLIS">
        CHOLOPOLIS
      </span>
    </h1>
  );
}
