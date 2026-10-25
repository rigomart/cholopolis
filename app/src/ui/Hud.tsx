import { useEffect, useRef, useState } from "preact/hooks";

import { JAIL_FINE, square } from "../../../shared/board.ts";
import {
  type Action,
  debtors,
  type DrawnCard,
  findPlayer,
  type LogEntry,
  money,
  ownedBy,
  type Player,
  type PublicState,
} from "../../../shared/game.ts";
import { isMuted, setMuted } from "../audio.ts";
import type { Table } from "../useTable.ts";
import { Pawn, useNow } from "./bits.tsx";
import { Properties } from "./Properties.tsx";
import { RollButton } from "./RollButton.tsx";
import { TradeComposer, TradeOffers } from "./Trades.tsx";

interface Props {
  table: Table;
  onInspect: (index: number) => void;
  onNewRoom: () => void;
  onHome: () => void;
  /** Who is shaking the dice right now, if anyone. */
  shaking: string | null;
  onShake: (on: boolean) => void;
}

type Sheet = { kind: "props" } | { kind: "trade"; partner: string | null } | null;

export function Hud({ table, onInspect, onNewRoom, onHome, shaking, onShake }: Props) {
  const { state, you, spectators, send } = table;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [muted, setMutedState] = useState(isMuted);
  if (!state) return null;
  const me = findPlayer(state, you);
  const act = (action: Action) => send({ type: "action", action });
  const playing = state.phase === "playing";
  const canTrade = playing && me && !me.bankrupt;

  return (
    <div class="hud">
      <Players state={state} you={you} onTrade={canTrade ? (partner) => setSheet({ kind: "trade", partner }) : null} />
      <Log entries={state.log} />

      <div class="dock">
        {me && !me.bankrupt && <TradeOffers state={state} me={me} act={act} />}
        <ActionBar state={state} me={me} act={act} shaking={shaking} onShake={onShake} />
        <div class="toolbar">
          {canTrade && (
            <>
              <button type="button" onClick={() => setSheet(sheet?.kind === "props" ? null : { kind: "props" })}>
                Mis propiedades ({ownedBy(state, me.id).length})
              </button>
              <button type="button" onClick={() => setSheet({ kind: "trade", partner: null })}>
                Proponer trato
              </button>
            </>
          )}
          <button
            type="button"
            class="link"
            aria-pressed={!muted}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            {muted ? "Sin sonido" : "Con sonido"}
          </button>
          {canTrade && (
            <button
              type="button"
              class="link danger"
              onClick={() => confirm("¿Seguro que te rindes? Quedas fuera de la partida.") && act({ type: "bankrupt" })}
            >
              Rendirme
            </button>
          )}
        </div>
        {!me && (
          <p class="spectating">
            Estás mirando esta partida{spectators.length > 1 ? ` con ${spectators.length - 1} más` : ""}.
          </p>
        )}
      </div>

      <CardToast card={state.card} state={state} />

      {sheet?.kind === "props" && me && (
        <Properties state={state} me={me} act={act} onInspect={onInspect} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "trade" && me && (
        <TradeComposer state={state} me={me} initialPartner={sheet.partner} act={act} onClose={() => setSheet(null)} />
      )}
      {state.phase === "ended" && <Ended state={state} you={you} onNewRoom={onNewRoom} onHome={onHome} />}
    </div>
  );
}

function Players({
  state,
  you,
  onTrade,
}: {
  state: PublicState;
  you: string | null;
  onTrade: ((id: string) => void) | null;
}) {
  const turnId = state.turn?.playerId;
  const ticking = state.deadline !== null;
  const now = useNow(ticking);
  const seconds = state.deadline ? Math.max(0, Math.ceil((state.deadline - now) / 1000)) : null;

  return (
    <ol class="players" aria-label="Jugadores">
      {state.players.map((p) => {
        const isTurn = p.id === turnId;
        const tradable = onTrade && p.id !== you && !p.bankrupt;
        const body = (
          <>
            <Pawn player={p} />
            <span class="player-name">
              {p.name}
              {p.id === you && <span class="muted"> (tú)</span>}
            </span>
            <span class={p.cash < 0 ? "player-cash negative" : "player-cash"}>{money(p.cash)}</span>
            <span class="player-notes">
              {p.bankrupt && "en quiebra"}
              {p.inJail && "en el Penal"}
              {!p.connected && !p.bankrupt && " desconectado"}
              {isTurn && seconds !== null && <span class="clock"> {seconds}s</span>}
            </span>
          </>
        );
        return (
          <li
            key={p.id}
            class={[isTurn && "turn", p.bankrupt && "out", !p.connected && "away"].filter(Boolean).join(" ")}
          >
            {tradable ? (
              <button type="button" class="player" onClick={() => onTrade(p.id)} title={`Proponer trato a ${p.name}`}>
                {body}
              </button>
            ) : (
              <div class="player">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface ActionBarProps {
  state: PublicState;
  me: Player | undefined;
  act: (a: Action) => void;
  shaking: string | null;
  onShake: (on: boolean) => void;
}

function ActionBar({ state, me, act, shaking, onShake }: ActionBarProps) {
  if (state.phase !== "playing" || !state.turn) return null;
  const current = findPlayer(state, state.turn.playerId);
  const owing = debtors(state);
  const myTurn = me?.id === state.turn.playerId;

  if (me && me.cash < 0 && !me.bankrupt) {
    const creditor = findPlayer(state, me.creditor);
    return (
      <div class="actions alert-bar">
        <p>
          Debes {money(-me.cash)} a {creditor?.name ?? "el banco"}. Vende casas o hipoteca en Mis propiedades, o negocia
          un trato.
        </p>
        <button
          type="button"
          class="danger"
          onClick={() => confirm("¿Declararte en quiebra? Quedas fuera de la partida.") && act({ type: "bankrupt" })}
        >
          Declararme en quiebra
        </button>
      </div>
    );
  }
  if (owing.length > 0) {
    return (
      <div class="actions">
        <p>Esperando a que {owing.map((p) => p.name).join(" y ")} pague sus deudas.</p>
      </div>
    );
  }
  if (!myTurn || !me) {
    return (
      <div class="actions">
        <p>
          {current && <Pawn player={current} size={14} />}{" "}
          {shaking && shaking === current?.id
            ? `${current.name} está revolviendo los dados…`
            : `Juega ${current?.name}.`}
        </p>
      </div>
    );
  }

  const here = square(me.position);
  switch (state.turn.stage) {
    case "roll":
      return (
        <div class="actions">
          {me.inJail ? (
            <>
              <p>Estás en el Penal (intento {me.jailTurns + 1} de 3).</p>
              <RollButton label="Tirar por dobles" onShake={onShake} onRoll={() => act({ type: "roll" })} />
              <button type="button" disabled={me.cash < JAIL_FINE} onClick={() => act({ type: "payJailFine" })}>
                Pagar fianza {money(JAIL_FINE)}
              </button>
              {me.jailCards.length > 0 && (
                <button type="button" onClick={() => act({ type: "useJailCard" })}>
                  Usar tarjeta
                </button>
              )}
            </>
          ) : (
            <RollButton
              label={state.turn.doubles > 0 ? "¡Dobles! Tira otra vez" : "Tirar dados"}
              onShake={onShake}
              onRoll={() => act({ type: "roll" })}
            />
          )}
        </div>
      );
    case "buy": {
      const price = "price" in here ? here.price : 0;
      return (
        <div class="actions">
          <p>
            {here.name} no tiene dueño. Cuesta {money(price)}.
            {me.cash < price && " No te alcanza: hipoteca algo o déjala pasar."}
          </p>
          <button type="button" class="primary big" disabled={me.cash < price} onClick={() => act({ type: "buy" })}>
            Comprar por {money(price)}
          </button>
          <button type="button" onClick={() => act({ type: "decline" })}>
            No comprar
          </button>
        </div>
      );
    }
    case "done":
      return (
        <div class="actions">
          <button type="button" class="primary big" onClick={() => act({ type: "endTurn" })}>
            Terminar turno
          </button>
        </div>
      );
  }
}

function Log({ entries }: { entries: LogEntry[] }) {
  const list = useRef<HTMLOListElement>(null);
  const last = entries.at(-1)?.id;
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [last]);
  return (
    <details class="log" open={matchMedia("(min-width: 900px)").matches}>
      <summary>Lo que pasó</summary>
      <ol ref={list} aria-live="polite">
        {entries.slice(-40).map((e) => (
          <li key={e.id}>{e.text}</li>
        ))}
      </ol>
    </details>
  );
}

/** Shows each newly drawn card for a few seconds. */
function CardToast({ card, state }: { card: DrawnCard | null; state: PublicState }) {
  const [seenId, setSeenId] = useState(card?.id ?? 0);
  const [shown, setShown] = useState<DrawnCard | null>(null);
  if (card && card.id !== seenId) {
    setSeenId(card.id);
    setShown(card);
  }
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), 5000);
    return () => clearTimeout(id);
  }, [shown]);
  if (!shown) return null;
  const who = findPlayer(state, shown.playerId);
  return (
    <button type="button" class={`card-toast ${shown.deck}`} onClick={() => setShown(null)}>
      <span class="card-deck">{shown.deck === "suerte" ? "Suerte" : "Caja Municipal"}</span>
      <span class="card-text">{shown.text}</span>
      <span class="card-who">para {who?.name}</span>
    </button>
  );
}

function Ended({
  state,
  you,
  onNewRoom,
  onHome,
}: {
  state: PublicState;
  you: string | null;
  onNewRoom: () => void;
  onHome: () => void;
}) {
  const winner = findPlayer(state, state.winnerId);
  return (
    <dialog open class="ended" aria-labelledby="ended-title">
      <div class="panel">
        {winner && <Pawn player={winner} size={40} />}
        <h2 id="ended-title">
          {winner?.id === you ? "¡Ganaste Cholopolis!" : `¡${winner?.name ?? "Alguien"} ganó Cholopolis!`}
        </h2>
        <p class="muted">Los demás quedaron en quiebra.</p>
        <div class="ended-actions">
          <button type="button" class="primary" onClick={onNewRoom}>
            Abrir otra mesa
          </button>
          <button type="button" onClick={onHome}>
            Volver al inicio
          </button>
        </div>
      </div>
    </dialog>
  );
}
