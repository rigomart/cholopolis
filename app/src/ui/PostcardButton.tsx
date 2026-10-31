import "./postcard.css";
import { useEffect, useRef, useState } from "preact/hooks";

import type { PublicState } from "../../../shared/game.ts";
import { postcard, sharePostcard } from "../postcard.ts";

/** Outlasts the longest ending on the board: a 12-square walk (190 ms a hop), then a bankrupt piece's 900 ms exit. */
const SETTLE_MS = 3500;

/**
 * Composes the postcard as soon as the end screen opens, so a tap can share it at once: phones
 * only open the share sheet straight from a tap.
 */
export function PostcardButton({ state }: { state: PublicState }) {
  const [card, setCard] = useState<Blob | "failed" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const finalState = useRef(state);

  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      postcard(finalState.current).then(
        (blob) => live && setCard(blob),
        (error) => {
          console.error(error);
          if (live) setCard("failed");
        },
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, []);

  if (card === "failed") return <p class="muted postcard">No se pudo armar la postal.</p>;
  const share = async () => {
    if (!(card instanceof Blob) || sharing) return;
    // A second tap while the share sheet is open would fail and fall back to a download too.
    setSharing(true);
    try {
      const outcome = await sharePostcard(card);
      setNote(outcome === "downloaded" ? "Postal descargada. ¡Pásala por el grupo!" : null);
    } finally {
      setSharing(false);
    }
  };
  return (
    <div class="postcard">
      <button type="button" class="postcard-share" disabled={!card || sharing} onClick={share}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          aria-hidden="true"
        >
          <path d="M12 15V3m0 0L7 8m5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        {card ? "Compartir postal" : "Armando la postal…"}
      </button>
      {note && <output class="muted postcard-note">{note}</output>}
    </div>
  );
}
