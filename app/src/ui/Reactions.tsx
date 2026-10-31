import "./reactions.css";
import { useEffect, useRef, useState } from "preact/hooks";

import { findPlayer, type PublicState } from "../../../shared/game.ts";
import { REACTIONS, reactionOf } from "../../../shared/reactions.ts";
import type { BoardScene } from "../scene/BoardScene.ts";
import type { Bubble } from "../useReactions.ts";
import type { Table } from "../useTable.ts";

/** The reaction buttons: behind a toolbar toggle in the game, always shown when `open` (the lobby). */
export function ReactionTray({ table, open = false }: { table: Table; open?: boolean }) {
  const { you, reactions } = table;
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  if (!you) return null;
  const shown = open || expanded;
  const buttons = (
    <fieldset class="reaction-row">
      <legend class="visually-hidden">Reacciones rápidas</legend>
      {REACTIONS.map((r) => (
        <button
          key={r.id}
          type="button"
          class="reaction-button"
          aria-label={`Reaccionar: ${r.label}`}
          title={r.label}
          aria-disabled={reactions.cooling}
          onClick={() => {
            reactions.react(r.id);
            setExpanded(false);
            toggle.current?.focus();
          }}
        >
          <span aria-hidden="true">{r.glyph}</span>
        </button>
      ))}
    </fieldset>
  );
  if (open) return buttons;
  return (
    <>
      <button type="button" class="link reaction-toggle" aria-expanded={shown} onClick={() => setExpanded(!expanded)}>
        Reaccionar
      </button>
      {shown && buttons}
    </>
  );
}

export function ReactionBadge({ bubble, name }: { bubble: Bubble | undefined; name: string }) {
  if (!bubble) return null;
  const r = reactionOf(bubble.reaction);
  return (
    <span key={bubble.id} class="reaction-bubble">
      <span aria-hidden="true">{r.glyph}</span>
      <span class="visually-hidden">{`${name}: ${r.label}`}</span>
    </span>
  );
}

export function PawnBubbles({
  state,
  scene,
  bubbles,
}: {
  state: PublicState;
  scene: BoardScene;
  bubbles: Table["reactions"]["bubbles"];
}) {
  const ids = Object.keys(bubbles).filter((id) => findPlayer(state, id));
  const refs = useRef(new Map<string, HTMLSpanElement>());
  const active = ids.length > 0;

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const follow = () => {
      for (const [id, el] of refs.current) {
        const at = scene.pieceScreenPosition(id);
        el.style.visibility = at ? "visible" : "hidden";
        if (at) el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [active, scene]);

  return (
    <div class="pawn-bubbles" aria-hidden="true">
      {ids.map((id) => {
        const bubble = bubbles[id]!;
        return (
          <span
            key={id}
            class="pawn-bubble-anchor"
            style={{ visibility: "hidden" }}
            ref={(el) => {
              if (el) refs.current.set(id, el);
              else refs.current.delete(id);
            }}
          >
            <span key={bubble.id} class="reaction-bubble pawn-bubble">
              {reactionOf(bubble.reaction).glyph}
            </span>
          </span>
        );
      })}
    </div>
  );
}
