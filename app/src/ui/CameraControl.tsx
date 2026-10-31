import { useEffect, useRef, useState } from "preact/hooks";

import type { BoardScene } from "../scene/BoardScene.ts";
import type { ViewName } from "../scene/cameraViews.ts";

export type BoardCamera = Pick<
  BoardScene,
  "showView" | "rotateCamera" | "onCameraView" | "followPlay" | "setFollowPlay"
>;

/**
 * Turns the board a side at a time and picks a view: the whole board, from straight above, or
 * close on a pawn (`pawnOf`: yours, or for spectators whoever's turn it is).
 */
export function CameraControl({ camera, pawnOf, mine }: { camera: BoardCamera; pawnOf: string | null; mine: boolean }) {
  const [view, setView] = useState<ViewName | null>("tablero");
  const [open, setOpen] = useState(false);
  const [follow, setFollow] = useState(camera.followPlay);
  const root = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    camera.onCameraView(setView);
    return () => camera.onCameraView(null);
  }, [camera]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", escape);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", escape);
    };
  }, [open]);

  const views: { id: ViewName; label: string }[] = [
    { id: "tablero", label: "Tablero" },
    { id: "arriba", label: "Desde arriba" },
    { id: "ficha", label: mine ? "Mi ficha" : "Ficha en juego" },
  ];
  const current = views.find((v) => v.id === view);

  return (
    <fieldset ref={root} class="camera-control" aria-label="Cámara">
      <button type="button" onClick={() => camera.rotateCamera(-1)} aria-label="Girar a la izquierda" title="Girar (←)">
        <TurnIcon />
      </button>
      <button
        type="button"
        class="camera-views"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Vista: ${current?.label ?? "libre"}`}
        onClick={() => setOpen(!open)}
      >
        <EyeIcon />
        <span class="camera-label">{current?.label ?? "Vista"}</span>
      </button>
      <button
        type="button"
        class="flip"
        onClick={() => camera.rotateCamera(1)}
        aria-label="Girar a la derecha"
        title="Girar (→)"
      >
        <TurnIcon />
      </button>
      {open && (
        <div class="camera-menu">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              class={v.id === view ? "primary" : undefined}
              aria-pressed={v.id === view}
              disabled={v.id === "ficha" && !pawnOf}
              onClick={() => {
                camera.showView(v.id, pawnOf);
                setOpen(false);
              }}
            >
              {v.label}
            </button>
          ))}
          <label class="check">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => {
                camera.setFollowPlay(e.currentTarget.checked);
                setFollow(e.currentTarget.checked);
              }}
            />
            Seguir la jugada
          </label>
          <p class="muted">Doble toque en una casilla para acercarte; en el centro, para volver.</p>
        </div>
      )}
    </fieldset>
  );
}

function TurnIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 3v5h5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
