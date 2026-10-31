import "./hud.css";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { JAIL_FINE, square } from "../../../shared/board.ts";
import {
  type Action,
  debtors,
  debtsOf,
  type DrawnCard,
  findPlayer,
  type LogEntry,
  money,
  ownedBy,
  PLAYER_COLORS,
  type Player,
  type PublicState,
  ranking,
  rematchHost,
} from "../../../shared/game.ts";
import { isMuted, setMuted } from "../audio.ts";
import type { Table } from "../useTable.ts";
import { Pawn } from "./bits.tsx";
import { type BoardCamera, CameraControl } from "./CameraControl.tsx";
import { MoneyFlows, RollingCash, useMoneyState } from "./Cash.tsx";
import { Confetti } from "./Confetti.tsx";
import { Pips } from "./Pips.tsx";
import { PostcardButton } from "./PostcardButton.tsx";
import { Properties } from "./Properties.tsx";
import { GamePoints } from "./Ranking.tsx";
import { ReactionBadge, ReactionTray } from "./Reactions.tsx";
import { RollButton } from "./RollButton.tsx";
import { type BoardLink, type BoardPick, type DealStart, TradeComposer, TradeOffers } from "./Trades.tsx";
import { GameClock, TurnBanner, TurnClock, TurnRing, useTurnAttention } from "./TurnClock.tsx";

interface Props {
  table: Table;
  onInspect: (index: number) => void;
  onNewRoom: () => void;
  onHome: () => void;
  /** The 3D board's camera; null without WebGL. */
  camera: (BoardCamera & { focusPlayer: (id: string) => void }) | null;
  shaking: string | null;
  onRoll: () => void;
  rolling: boolean;
  /** Whether the dice thrown for roll `rollId` are on the board yet. */
  diceLanded: (rollId: number) => boolean;
  sheet: Sheet;
  onSheet: (sheet: Sheet) => void;
  board: BoardLink;
  boardPick: BoardPick;
}

/** The side sheet that is open; `opened` tells a fresh deal table from the one already open. */
export type Sheet = { kind: "props" } | ({ kind: "trade"; opened: number } & DealStart) | null;

export const dealSheet = (start: DealStart): Sheet => ({ kind: "trade", opened: Date.now(), ...start });

export function Hud({
  table,
  onInspect,
  onNewRoom,
  onHome,
  camera,
  shaking,
  onRoll,
  rolling,
  diceLanded,
  sheet,
  onSheet: setSheet,
  board,
  boardPick,
}: Props) {
  const { state, you, spectators, send, serverNow } = table;
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
        onTrade={canTrade ? (partner) => setSheet(dealSheet({ partner })) : null}
        onFocus={camera ? (id) => camera.focusPlayer(id) : null}
        settled={balances.state}
        list={playerList}
        now={serverNow}
        bubbles={table.reactions.bubbles}
      />
      <MoneyFlows batches={balances.batches} list={playerList} />
      <Log entries={state.log} />
      {camera && !sheet && (
        <CameraControl
          camera={camera}
          pawnOf={me && !me.bankrupt ? me.id : (state.turn?.playerId ?? null)}
          mine={Boolean(me && !me.bankrupt)}
        />
      )}

      <div class="dock">
        {me && !me.bankrupt && (
          <TradeOffers
            state={state}
            me={me}
            act={act}
            onCounter={(start) => setSheet(dealSheet(start))}
            board={board}
          />
        )}
        <GameClock state={state} now={serverNow} />
        <TurnClock state={state} you={you} shaking={shaking} now={serverNow} />
        <ActionBar state={state} me={me} act={act} onRoll={onRoll} rolling={rolling} />
        <div class="toolbar">
          {canTrade && (
            <>
              <button type="button" onClick={() => setSheet(sheet?.kind === "props" ? null : { kind: "props" })}>
                Mis propiedades <CountBadge count={ownedBy(state, me.id).length} />
              </button>
              <button type="button" onClick={() => setSheet(dealSheet({ partner: null }))}>
                Proponer trato
              </button>
            </>
          )}
          <ReactionTray table={table} />
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
        <TradeComposer
          key={sheet.opened}
          state={state}
          me={me}
          start={sheet}
          act={act}
          onClose={() => setSheet(null)}
          board={board}
          boardPick={boardPick}
        />
      )}
      {state.phase === "ended" && (
        <Ended
          state={state}
          you={you}
          onRematch={() => act({ type: "rematch" })}
          onNewRoom={onNewRoom}
          onHome={onHome}
        />
      )}
    </div>
  );
}

function Players({
  state,
  you,
  onTrade,
  onFocus,
  settled,
  list,
  now,
  bubbles,
}: {
  state: PublicState;
  you: string | null;
  onTrade: ((id: string) => void) | null;
  onFocus: ((id: string) => void) | null;
  settled: PublicState;
  list: RefObject<HTMLOListElement | null>;
  now: () => number;
  bubbles: Table["reactions"]["bubbles"];
}) {
  const turnId = state.turn?.playerId;
  const press = useLongPress();

  return (
    <ol ref={list} class="players" aria-label="Jugadores">
      {state.players.map((p) => {
        const isTurn = p.id === turnId;
        const tradable = onTrade && p.id !== you && !p.bankrupt;
        const trade = tradable ? () => onTrade(p.id) : null;
        const focus = onFocus && !p.bankrupt ? () => onFocus(p.id) : null;
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
              {p.bot && <span class="muted"> (bot)</span>}
            </span>
            <RollingCash id={p.id} cash={cash} />
            <Pips state={state} playerId={p.id} />
            <ReactionBadge bubble={bubbles[p.id]} name={p.name} />
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
            style={{ "--seat": PLAYER_COLORS[p.color] }}
            class={[isTurn && "turn", p.bankrupt && "out", !p.connected && "away", cash < 0 && !p.bankrupt && "owing"]
              .filter(Boolean)
              .join(" ")}
          >
            {focus ? (
              <button
                type="button"
                class="player"
                {...press(focus, trade)}
                title={`Ver la ficha de ${p.name}${trade ? ". Mantén presionado para proponerle un trato" : ""}`}
              >
                {body}
              </button>
            ) : trade ? (
              <button type="button" class="player" onClick={trade} title={`Proponer trato a ${p.name}`}>
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

const LONG_PRESS_MS = 500;

function useLongPress() {
  const held = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean }>({ fired: false });
  useEffect(() => () => clearTimeout(held.current.timer), []);
  const release = () => clearTimeout(held.current.timer);
  return (onTap: () => void, onHold: (() => void) | null) => {
    return {
      onClick: () => {
        if (!held.current.fired) onTap();
        held.current.fired = false;
      },
      onPointerDown: () => {
        held.current.fired = false;
        release();
        if (onHold)
          held.current.timer = setTimeout(() => {
            held.current.fired = true;
            onHold();
          }, LONG_PRESS_MS);
      },
      onPointerUp: release,
      onPointerLeave: release,
      onPointerCancel: release,
      onContextMenu: (e: Event) => {
        if (!onHold) return;
        e.preventDefault();
        release();
        held.current.fired = true;
        onHold();
      },
    };
  };
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
  onRoll: () => void;
  rolling: boolean;
}

function ActionBar({ state, me, act, onRoll, rolling }: ActionBarProps) {
  if (state.phase !== "playing" || !state.turn) return null;
  const owing = debtors(state);
  const myTurn = me?.id === state.turn.playerId;

  if (me && me.cash < 0 && !me.bankrupt) {
    const parts = debtsOf(me).map(
      (d) => `${money(d.amount)} ${d.to ? `a ${findPlayer(state, d.to)?.name}` : "al banco"}`,
    );
    const owed =
      parts.length > 1
        ? `${money(-me.cash)}: ${new Intl.ListFormat("es-PE").format(parts)}`
        : (parts[0] ?? `${money(-me.cash)} al banco`);
    return (
      <div class="actions alert-bar">
        <p>Debes {owed}. Vende casas o hipoteca en Mis propiedades, o negocia un trato.</p>
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
  // Someone else's turn or debt is the clock's to say.
  if (owing.length > 0 || !myTurn || !me) return null;

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
          <li key={e.id} class={e.id > lastIdOnMount ? "fresh" : undefined} data-serial={String(e.id).padStart(3, "0")}>
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
  onRematch,
  onNewRoom,
  onHome,
}: {
  state: PublicState;
  you: string | null;
  onRematch: () => void;
  onNewRoom: () => void;
  onHome: () => void;
}) {
  const winner = findPlayer(state, state.winnerId);
  const asker = rematchHost(state);
  return (
    <dialog open class="ended" aria-labelledby="ended-title">
      <Confetti />
      <div class="panel">
        {winner && <Pawn player={winner} size={40} />}
        <h2 id="ended-title">
          {winner?.id === you ? "¡Ganaste Cholopolis!" : `¡${winner?.name ?? "Alguien"} ganó Cholopolis!`}
        </h2>
        {state.endedByTime ? (
          <>
            <p class="muted">Se acabó el tiempo. Gana quien tiene más patrimonio: efectivo, propiedades y edificios.</p>
            <ol class="ranking">
              {ranking(state).map(({ player, worth }) => (
                <li
                  key={player.id}
                  class={player.id === state.winnerId ? "winner" : undefined}
                  style={{ "--seat": PLAYER_COLORS[player.color] }}
                >
                  <Pawn player={player} size={14} />
                  <span class="ranking-name">
                    {player.name}
                    {player.id === you && <span class="muted"> (tú)</span>}
                  </span>
                  <span class="ranking-worth">{money(worth)}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p class="muted">Los demás quedaron en quiebra.</p>
        )}
        <GamePoints state={state} you={you} />
        <PostcardButton state={state} />
        <div class="ended-actions">
          {asker?.id === you ? (
            <button type="button" class="primary" onClick={onRematch}>
              Revancha
            </button>
          ) : (
            asker && <p class="waiting">{asker.name} puede pedir la revancha.</p>
          )}
          <button type="button" class={asker?.id === you ? undefined : "primary"} onClick={onNewRoom}>
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
