import { useState } from "preact/hooks";

import { MAX_PLAYERS } from "../../../shared/board.ts";
import { findPlayer, TIME_LIMITS } from "../../../shared/game.ts";
import { PIECES } from "../../../shared/pieces.ts";
import type { Table } from "../useTable.ts";
import { Pawn, Wordmark } from "./bits.tsx";
import { ReactionBadge, ReactionTray } from "./Reactions.tsx";

interface Props {
  table: Table;
  room: string;
  onLeave: () => void;
  onNewRoom: () => void;
}

export function Lobby({ table, room, onLeave, onNewRoom }: Props) {
  const { state, you, spectators, send, name } = table;
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  const me = findPlayer(state, you);
  const host = findPlayer(state, state.hostId);
  const hosting = me !== undefined && me.id === state.hostId;
  const present = state.players.filter((p) => p.connected).length;
  const link = `${location.origin}/mesa/${room}`;
  const seatFree = state.players.length < MAX_PLAYERS || state.players.some((p) => !p.connected);
  const isHost = me?.id === state.hostId;

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main class="lobby-wrap">
      <section class="panel lobby" aria-labelledby="lobby-title">
        <Wordmark small />
        <h2 id="lobby-title">Mesa {room}</h2>
        <p class="muted">
          {present} de {MAX_PLAYERS} jugadores. Pasa el enlace para que entren tus amigos, o completa la mesa con bots.
        </p>
        <div class="share">
          <input readOnly value={link} aria-label="Enlace de la mesa" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={copy}>
            {copied ? "Copiado" : "Copiar enlace"}
          </button>
        </div>

        <ul class="roster">
          {state.players.map((p) => (
            <li key={p.id} class={p.connected ? "" : "away"}>
              <Pawn player={p} />
              <span class="roster-name">
                {p.name}
                {p.id === you && <span class="muted"> (tú)</span>}
              </span>
              <ReactionBadge bubble={table.reactions.bubbles[p.id]} name={p.name} />
              {p.id === state.hostId && <span class="tag">abre la partida</span>}
              {p.bot && <span class="tag">bot</span>}
              {!p.connected && <span class="muted">desconectado</span>}
              {p.bot && hosting && (
                <button
                  type="button"
                  class="link"
                  aria-label={`Sacar a ${p.name}`}
                  onClick={() => send({ type: "action", action: { type: "removeBot", player: p.id } })}
                >
                  Sacar
                </button>
              )}
            </li>
          ))}
        </ul>
        {hosting && state.players.length < MAX_PLAYERS && (
          <button type="button" class="add-bot" onClick={() => send({ type: "action", action: { type: "addBot" } })}>
            Agregar bot
          </button>
        )}

        {me && (
          <fieldset class="pieces">
            <legend>Tu ficha</legend>
            {PIECES.map((piece, i) => {
              const holder = state.players.find((p) => p.piece === i);
              const mine = holder?.id === me.id;
              return (
                <button
                  key={piece.id}
                  type="button"
                  class={mine ? "piece mine" : "piece"}
                  aria-pressed={mine}
                  disabled={Boolean(holder) && !mine}
                  title={holder && !mine ? `La tiene ${holder.name}` : piece.name}
                  onClick={() => send({ type: "action", action: { type: "choosePiece", piece: i } })}
                >
                  <Pawn player={{ piece: i, color: holder?.color ?? me.color }} size={26} />
                  <span>{piece.name}</span>
                </button>
              );
            })}
          </fieldset>
        )}
        {me && <ReactionTray table={table} open />}

        <fieldset class="lengths">
          <legend>Duración</legend>
          {isHost ? (
            [null, ...TIME_LIMITS].map((minutes) => (
              <button
                key={minutes ?? "none"}
                type="button"
                class={minutes === state.timeLimit ? "length mine" : "length"}
                aria-pressed={minutes === state.timeLimit}
                onClick={() => send({ type: "action", action: { type: "setTimeLimit", minutes } })}
              >
                {minutes === null ? "Sin límite" : `${minutes} min`}
              </button>
            ))
          ) : (
            <p class="muted">
              {state.timeLimit === null
                ? "Sin límite de tiempo."
                : `${state.timeLimit} minutos. Gana quien tenga más patrimonio al terminar.`}
            </p>
          )}
        </fieldset>

        {me ? (
          hosting ? (
            <button
              type="button"
              class="primary big"
              disabled={present < 2}
              onClick={() => send({ type: "action", action: { type: "start" } })}
            >
              {present < 2 ? "Falta al menos un jugador más" : "Empezar partida"}
            </button>
          ) : (
            <p class="waiting">Esperando a que {host?.name ?? "el anfitrión"} empiece la partida.</p>
          )
        ) : seatFree ? (
          <>
            <p class="waiting">Hay un lugar libre en la mesa.</p>
            <button type="button" class="primary" onClick={() => send({ type: "join", name })}>
              Sentarme
            </button>
          </>
        ) : (
          <>
            <p class="waiting">Esta mesa está llena. Puedes mirar o abrir otra.</p>
            <button type="button" class="primary" onClick={onNewRoom}>
              Abrir otra mesa
            </button>
          </>
        )}
        <div class="lobby-foot">
          {spectators.length > 0 && <span class="muted">Mirando: {spectators.join(", ")}</span>}
          <button type="button" class="link" onClick={onLeave}>
            Salir de la mesa
          </button>
        </div>
      </section>
    </main>
  );
}
