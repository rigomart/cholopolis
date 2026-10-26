import "./hud.css";
import type { RefObject } from "preact";
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
import { Pawn } from "./bits.tsx";
import { MoneyFlows, RollingCash, useMoneyState } from "./Cash.tsx";
import { Confetti } from "./Confetti.tsx";
import { Pips } from "./Pips.tsx";
import { Properties } from "./Properties.tsx";
import { RollButton } from "./RollButton.tsx";
import { TradeComposer, TradeOffers } from "./Trades.tsx";
import { TurnBanner, TurnClock, TurnRing, useTurnAttention } from "./TurnClock.tsx";

interface Props {
  table: Table;
  onInspect: (index: number) => void;
  onNewRoom: () => void;
  onHome: () => void;
  onResetCamera?: () => void;
  shaking: string | null;
  onRoll: () => void;
  rolling: boolean;
  /** Whether the dice thrown for roll `rollId` are on the board yet. */
  diceLanded: (rollId: number) => boolean;
}

type Sheet = { kind: "props" } | { kind: "trade"; partner: string | null } | null;

export function Hud({
  table,
  onInspect,
  onNewRoom,
  onHome,
  onResetCamera,
  shaking,
  onRoll,
  rolling,
  diceLanded,
}: Props) {
  const { state, you, spectators, send, serverNow } = table;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [muted, setMutedState] = useState(isMuted);
  const playerList = useRef<HTMLOListElement>(null);
  useTurnAttention(state, you);
  const balances = useMoneyState(state, diceLanded);
  if (!state || !balances.state) return null;
  const me = findPlayer(state, you);
  const act = (action: Action) => send({ type: "action", action });
  const playing = state.phase === "playing";
  const canTrade = playing && me && !me.bankrupt;

  return (
    <div class="hud">
      <Players
        state={state}
        you={you}
        onTrade={canTrade ? (partner) => setSheet({ kind: "trade", partner }) : null}
        settled={balances.state}
        list={playerList}
        now={serverNow}
      />
      <MoneyFlows batches={balances.batches} list={playerList} />
      <Log entries={state.log} />
      {onResetCamera && !sheet && (
        <button
          type="button"
          class="camera-reset"
          onClick={onResetCamera}
          aria-label="Centrar tablero"
          title="Centrar tablero"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v6m0 8v6M2 12h6m8 0h6" />
          </svg>
          <span>Centrar tablero</span>
        </button>
      )}

      <div class="dock">
        {me && !me.bankrupt && <TradeOffers state={state} me={me} act={act} />}
        <TurnClock state={state} you={you} now={serverNow} />
        <ActionBar state={state} me={me} act={act} shaking={shaking} onRoll={onRoll} rolling={rolling} />
        <div class="toolbar">
          {canTrade && (
            <>
              <button type="button" onClick={() => setSheet(sheet?.kind === "props" ? null : { kind: "props" })}>
                Mis propiedades <CountBadge count={ownedBy(state, me.id).length} />
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

      <TurnBanner state={state} you={you} />
      <CardToast
        card={state.card}
        state={state}
        diceLanded={diceLanded}
        yours={state.turn?.playerId === you && state.turn.stage === "roll"}
        held={shaking !== null && shaking === you}
      />

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
  settled,
  list,
  now,
}: {
  state: PublicState;
  you: string | null;
  onTrade: ((id: string) => void) | null;
  settled: PublicState;
  list: RefObject<HTMLOListElement | null>;
  now: () => number;
}) {
  const turnId = state.turn?.playerId;

  return (
    <ol ref={list} class="players" aria-label="Jugadores">
      {state.players.map((p) => {
        const isTurn = p.id === turnId;
        const tradable = onTrade && p.id !== you && !p.bankrupt;
        const cash = findPlayer(settled, p.id)?.cash ?? p.cash;
        const body = (
          <>
            <TurnRing state={state} playerId={p.id} now={now}>
              <Pawn player={p} />
            </TurnRing>
            {p.inJail && <span class="jail-bars" />}
            <span class="player-name">
              {p.name}
              {p.id === you && <span class="muted"> (tú)</span>}
            </span>
            <RollingCash id={p.id} cash={cash} />
            <Pips state={state} playerId={p.id} />
            <span class="player-notes">
              {p.bankrupt && "en quiebra"}
              {p.inJail && "en el Penal"}
              {!p.connected && !p.bankrupt && " desconectado"}
            </span>
          </>
        );
        return (
          <li
            key={p.id}
            class={[isTurn && "turn", p.bankrupt && "out", !p.connected && "away", cash < 0 && !p.bankrupt && "owing"]
              .filter(Boolean)
              .join(" ")}
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

function CountBadge({ count }: { count: number }) {
  const [seen, setSeen] = useState(count);
  const [bumps, setBumps] = useState(0);
  if (count !== seen) {
    setSeen(count);
    if (count > seen) setBumps(bumps + 1);
  }
  return (
    <span key={bumps} class={bumps > 0 ? "count-badge bump" : "count-badge"}>
      {count}
    </span>
  );
}

interface ActionBarProps {
  state: PublicState;
  me: Player | undefined;
  act: (a: Action) => void;
  shaking: string | null;
  onRoll: () => void;
  rolling: boolean;
}

function ActionBar({ state, me, act, shaking, onRoll, rolling }: ActionBarProps) {
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
          <p class="dice-instructions">Agarra los dados y suéltalos con un impulso.</p>
          {me.inJail ? (
            <>
              <p>Estás en el Penal (intento {me.jailTurns + 1} de 3).</p>
              <RollButton label="Tirar por dobles" onRoll={onRoll} disabled={rolling} />
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
              onRoll={onRoll}
              disabled={rolling}
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
  const [lastIdOnMount] = useState(last ?? 0);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [last]);
  return (
    <details class="log" open={matchMedia("(min-width: 900px)").matches}>
      <summary>Lo que pasó</summary>
      <ol ref={list} aria-live="polite">
        {entries.slice(-40).map((e) => (
          <li key={e.id} class={e.id > lastIdOnMount ? "fresh" : undefined}>
            {e.text}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** A card stays up this long, or this much less once another is ready behind it. */
const CARD_MS = 5000;
const CARD_QUEUED_MS = 2500;

/**
 * Shows each newly drawn card for a few seconds, in order, each once the roll that drew it is on
 * the board: landed, cut short by a later roll, or never animated (reduced motion, reconnect).
 */
function CardToast({
  card,
  state,
  diceLanded,
  yours,
  held,
}: {
  card: DrawnCard | null;
  state: PublicState;
  diceLanded: (rollId: number) => boolean;
  /** Your roll is next: the card lets clicks through to the dice under it. */
  yours: boolean;
  /** You picked the dice up, so you're done reading. */
  held: boolean;
}) {
  const [seenId, setSeenId] = useState(card?.id ?? 0);
  const [queue, setQueue] = useState<{ card: DrawnCard; rollId: number }[]>([]);
  const [shown, setShown] = useState<{ card: DrawnCard; at: number } | null>(null);
  if (card && card.id !== seenId) {
    setSeenId(card.id);
    setQueue([...queue, { card, rollId: state.rollId }]);
  }
  const next = queue[0];
  useEffect(() => {
    if (!next) return;
    // Polled: the scene starts the throw after this effect runs, and it lands seconds later.
    const id = setInterval(() => {
      if (shown && performance.now() - shown.at < CARD_QUEUED_MS) return;
      if (!diceLanded(next.rollId)) return;
      setShown({ card: next.card, at: performance.now() });
      setQueue((q) => q.slice(1));
    }, 100);
    return () => clearInterval(id);
  }, [next, shown, diceLanded]);
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), CARD_MS);
    return () => clearTimeout(id);
  }, [shown]);
  useEffect(() => {
    if (held) setShown(null);
  }, [held]);
  if (!shown) return null;
  const { card: drawn } = shown;
  const who = findPlayer(state, drawn.playerId);
  return (
    <button
      key={drawn.id}
      type="button"
      class={`card-toast ${drawn.deck}${yours ? " passive" : ""}`}
      onClick={() => setShown(null)}
    >
      <span class="card-deck">{drawn.deck === "suerte" ? "Suerte" : "Caja Municipal"}</span>
      <span class="card-text">{drawn.text}</span>
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
      <Confetti />
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
