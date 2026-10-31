import { useState } from "preact/hooks";

import { MAX_PLAYERS } from "../../../shared/board.ts";
import { findPlayer, PLAYER_COLORS, TIME_LIMITS } from "../../../shared/game.ts";
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
        <div class="lobby-head">
          <h2 id="lobby-title">Mesa {room}</h2>
          <span class="seat-count" title="Jugadores en la mesa">
            {present}/{MAX_PLAYERS}
          </span>
          <button type="button" class="share" title={link} onClick={copy}>
            {copied ? "¡Copiado!" : "Copiar enlace"}
          </button>
        </div>

        <ul class="roster">
          {state.players.map((p) => (
            <li key={p.id} class={p.connected ? "" : "away"} style={{ "--seat": PLAYER_COLORS[p.color] }}>
              <Pawn player={p} />
              <span class="roster-name">
                {p.name}
                {p.id === you && <span class="you-tag">tú</span>}
                {!p.connected && <span class="visually-hidden"> (desconectado)</span>}
              </span>
              <ReactionBadge bubble={table.reactions.bubbles[p.id]} name={p.name} />
              {p.id === state.hostId && (
                <span class="tag" title="Abre la partida">
                  anfitrión
                </span>
              )}
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
            + Agregar bot
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
            <span
              class="length mine"
              title={state.timeLimit === null ? undefined : "Al terminar gana el mayor patrimonio"}
            >
              {state.timeLimit === null ? "Sin límite" : `${state.timeLimit} min`}
            </span>
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
              {present < 2 ? "Falta otro jugador" : "Empezar partida"}
            </button>
          ) : (
            <p class="waiting">Esperando a que {host?.name ?? "el anfitrión"} empiece…</p>
          )
        ) : seatFree ? (
          <button type="button" class="primary big" onClick={() => send({ type: "join", name })}>
            Sentarme
          </button>
        ) : (
          <>
            <p class="waiting">Mesa llena.</p>
            <button type="button" class="primary" onClick={onNewRoom}>
              Abrir otra mesa
            </button>
          </>
        )}
        <div class="lobby-foot">
          {me && <ReactionTray table={table} />}
          {spectators.length > 0 && <span class="muted">Mirando: {spectators.join(", ")}</span>}
          <button type="button" class="link" onClick={onLeave}>
            Salir de la mesa
          </button>
        </div>
      </section>
    </main>
  );
}
