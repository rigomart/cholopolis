import "./hud.css";
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { type Deck, JAIL_FINE, square } from "../../../shared/board.ts";
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
import type { ShownState } from "../useShownState.ts";
import type { Table } from "../useTable.ts";
import { Pawn } from "./bits.tsx";
import { type BoardCamera, CameraControl } from "./CameraControl.tsx";
import { MoneyFlows, RollingCash } from "./Cash.tsx";
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
  /** What the HUD shows: the table's state, held back while a roll plays out on the board. */
  shown: ShownState;
  onInspect: (index: number) => void;
  onNewRoom: () => void;
  onHome: () => void;
  /** The 3D board's camera; null without WebGL. */
  camera: (BoardCamera & { focusPlayer: (id: string) => void }) | null;
  shaking: string | null;
  onRoll: () => void;
  rolling: boolean;
  sheet: Sheet;
  onSheet: (sheet: Sheet) => void;
  board: BoardLink;
  boardPick: BoardPick;
  /** A drawn card's toast just went up: the board lifts the top card of its deck. */
  onCardShown: (deck: Deck) => void;
}

/** The side sheet that is open; `opened` tells a fresh deal table from the one already open. */
export type Sheet = { kind: "props" } | ({ kind: "trade"; opened: number } & DealStart) | null;

export const dealSheet = (start: DealStart): Sheet => ({ kind: "trade", opened: Date.now(), ...start });

export function Hud({
  table,
  shown,
  onInspect,
  onNewRoom,
  onHome,
  camera,
  shaking,
  onRoll,
  rolling,
  sheet,
  onSheet: setSheet,
  board,
  boardPick,
  onCardShown,
}: Props) {
  const { you, spectators, send, serverNow } = table;
  const state = shown.state;
  const playerList = useRef<HTMLOListElement>(null);
  useTurnAttention(state, you);
  if (!state) return null;
  const me = findPlayer(state, you);
  const act = (action: Action) => send({ type: "action", action });
  const playing = state.phase === "playing";
  const canTrade = Boolean(playing && me && !me.bankrupt);
  const toggleProps = () => setSheet(sheet?.kind === "props" ? null : { kind: "props" });

  return (
    <div class="hud">
      <Players
        state={state}
        you={you}
        onTrade={canTrade ? (partner) => setSheet(dealSheet({ partner })) : null}
        onFocus={camera ? (id) => camera.focusPlayer(id) : null}
        list={playerList}
        now={serverNow}
        bubbles={table.reactions.bubbles}
      />
      <MoneyFlows batches={shown.batches} list={playerList} />
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
        <TurnPanel
          state={state}
          me={me}
          you={you}
          shaking={shaking}
          now={serverNow}
          act={act}
          onRoll={onRoll}
          rolling={rolling}
          onProps={() => setSheet({ kind: "props" })}
        />
        <div class="toolbar">
          {canTrade && me && (
            <>
              <button type="button" class="tool" aria-pressed={sheet?.kind === "props"} onClick={toggleProps}>
                <HouseIcon />
                Propiedades <CountBadge count={ownedBy(state, me.id).length} />
              </button>
              <button type="button" class="tool" onClick={() => setSheet(dealSheet({ partner: null }))}>
                <SwapIcon />
                Trato
              </button>
            </>
          )}
          {!me && (
            <span class="spectating" title="Estás mirando esta partida">
              <EyeIcon /> Mirando{spectators.length > 1 ? ` · ${spectators.length}` : ""}
            </span>
          )}
          <ReactionTray table={table} />
          <MoreMenu onSurrender={canTrade && me && me.cash >= 0 ? () => act({ type: "bankrupt" }) : null} />
        </div>
      </div>

      <TurnBanner state={state} you={you} />
      <CardToast
        card={state.card}
        state={state}
        yours={state.turn?.playerId === you && state.turn.stage === "roll"}
        held={shaking !== null && shaking === you}
        onShown={onCardShown}
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
  list,
  now,
  bubbles,
}: {
  state: PublicState;
  you: string | null;
  onTrade: ((id: string) => void) | null;
  onFocus: ((id: string) => void) | null;
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
        const notes = [p.bankrupt && "en quiebra", p.inJail && "en el Penal", !p.connected && "desconectado"];
        const note = notes.filter(Boolean).join(", ");
        const body = (
          <>
            <TurnRing state={state} playerId={p.id} now={now}>
              <Pawn player={p} />
            </TurnRing>
            {p.inJail && <span class="jail-bars" />}
            <span class="player-name">
              {p.name}
              {p.id === you && <span class="you-tag">tú</span>}
              {!p.connected && !p.bankrupt && <OfflineIcon />}
            </span>
            <RollingCash id={p.id} cash={p.cash} />
            <Pips state={state} playerId={p.id} />
            <ReactionBadge bubble={bubbles[p.id]} name={p.name} />
            {note && <span class="visually-hidden">{note}</span>}
          </>
        );
        return (
          <li
            key={p.id}
            style={{ "--seat": PLAYER_COLORS[p.color] }}
            class={[isTurn && "turn", p.bankrupt && "out", !p.connected && "away", p.cash < 0 && !p.bankrupt && "owing"]
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

interface TurnPanelProps {
  state: PublicState;
  me: Player | undefined;
  you: string | null;
  shaking: string | null;
  now: () => number;
  act: (a: Action) => void;
  onRoll: () => void;
  rolling: boolean;
  onProps: () => void;
}

function TurnPanel({ state, me, you, shaking, now, act, onRoll, rolling, onProps }: TurnPanelProps) {
  if (state.phase !== "playing" || !state.turn) return null;
  const clock = (label?: string) => <TurnClock state={state} you={you} shaking={shaking} now={now} label={label} />;
  const panel = (label: string | undefined, buttons: ComponentChildren, alert = false) => (
    <div class={alert ? "actions alert-bar" : "actions"}>
      {clock(label)}
      <div class="actions-row">{buttons}</div>
    </div>
  );

  if (me && me.cash < 0 && !me.bankrupt) {
    const to = debtsOf(me).map((d) => (d.to ? findPlayer(state, d.to)?.name : "el banco"));
    const owed = `Debes ${money(-me.cash)}${to.length === 1 ? ` a ${to[0]}` : ""}`;
    return panel(
      owed,
      <>
        <button type="button" class="primary" onClick={onProps}>
          Vender o hipotecar
        </button>
        <button
          type="button"
          class="danger"
          onClick={() => confirm("¿Declararte en quiebra? Quedas fuera de la partida.") && act({ type: "bankrupt" })}
        >
          Quiebra
        </button>
      </>,
      true,
    );
  }
  if (debtors(state).length > 0 || me?.id !== state.turn.playerId) return clock();

  const here = square(me.position);
  switch (state.turn.stage) {
    case "roll":
      if (me.inJail) {
        return panel(
          `En el Penal · ${me.jailTurns + 1}/3`,
          <>
            <RollButton label="Tirar por dobles" onRoll={onRoll} disabled={rolling} />
            <button type="button" disabled={me.cash < JAIL_FINE} onClick={() => act({ type: "payJailFine" })}>
              Fianza {money(JAIL_FINE)}
            </button>
            {me.jailCards.length > 0 && (
              <button type="button" onClick={() => act({ type: "useJailCard" })}>
                Usar tarjeta
              </button>
            )}
          </>,
        );
      }
      return panel(
        state.turn.doubles > 0 ? "¡Dobles! Otra vez" : undefined,
        <RollButton label="Tirar dados" onRoll={onRoll} disabled={rolling} />,
      );
    case "buy": {
      const price = "price" in here ? here.price : 0;
      const short = price - me.cash;
      return panel(
        here.name,
        <>
          <button type="button" class="primary big" disabled={short > 0} onClick={() => act({ type: "buy" })}>
            Comprar {money(price)}
          </button>
          <button type="button" onClick={() => act({ type: "decline" })}>
            No comprar
          </button>
          {short > 0 && <p class="actions-note">Te faltan {money(short)}</p>}
        </>,
      );
    }
    case "done":
      return panel(
        undefined,
        <button type="button" class="primary big" onClick={() => act({ type: "endTurn" })}>
          Terminar turno
        </button>,
      );
  }
}

const isTurnAnnouncement = (e: LogEntry) => e.text.startsWith("Turno de ");

function Log({ entries }: { entries: LogEntry[] }) {
  const list = useRef<HTMLOListElement>(null);
  const [open, setOpen] = useState(false);
  const last = entries.at(-1)?.id;
  const [lastIdOnMount] = useState(last ?? 0);
  const latest = entries.findLast((e) => !isTurnAnnouncement(e));
  useEffect(() => {
    if (open) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [last, open]);
  return (
    <details class="log" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary aria-label="Lo que pasó">
        <span key={latest?.id} class={latest && latest.id > lastIdOnMount ? "log-latest fresh" : "log-latest"}>
          {latest?.text ?? "Lo que pasó"}
        </span>
      </summary>
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

function CardToast({
  card,
  state,
  yours,
  held,
  onShown,
}: {
  card: DrawnCard | null;
  state: PublicState;
  /** Your roll is next: the card lets clicks through to the dice under it. */
  yours: boolean;
  /** You picked the dice up, so you're done reading. */
  held: boolean;
  onShown: (deck: Deck) => void;
}) {
  const [seenId, setSeenId] = useState(card?.id ?? 0);
  const [queue, setQueue] = useState<DrawnCard[]>([]);
  const [shown, setShown] = useState<{ card: DrawnCard; at: number } | null>(null);
  if (card && card.id !== seenId) {
    setSeenId(card.id);
    setQueue([...queue, card]);
  }
  const next = queue[0];
  useEffect(() => {
    if (!next) return;
    const wait = shown ? Math.max(0, CARD_QUEUED_MS - (performance.now() - shown.at)) : 0;
    const id = setTimeout(() => {
      setShown({ card: next, at: performance.now() });
      setQueue((q) => q.slice(1));
    }, wait);
    return () => clearTimeout(id);
  }, [next, shown]);
  useEffect(() => {
    if (shown) onShown(shown.card.deck);
  }, [shown, onShown]);
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

function MoreMenu({ onSurrender }: { onSurrender: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const root = useRef<HTMLDivElement>(null);
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
  return (
    <div ref={root} class="more">
      <button
        type="button"
        class="tool icon"
        aria-label="Más opciones"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div class="more-menu">
          <button
            type="button"
            aria-pressed={!muted}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            <SoundIcon off={muted} />
            {muted ? "Sin sonido" : "Con sonido"}
          </button>
          {onSurrender && (
            <button
              type="button"
              class="danger"
              onClick={() => {
                setOpen(false);
                if (confirm("¿Seguro que te rindes? Quedas fuera de la partida.")) onSurrender();
              }}
            >
              Rendirme
            </button>
          )}
        </div>
      )}
    </div>
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
        <h2 id="ended-title">{winner?.id === you ? "¡Ganaste!" : `¡Ganó ${winner?.name ?? "alguien"}!`}</h2>
        <p class="muted">
          {state.endedByTime ? "Se acabó el tiempo: gana el mayor patrimonio." : "Los demás quebraron."}
        </p>
        {state.endedByTime && (
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
                  {player.id === you && <span class="you-tag">tú</span>}
                </span>
                <span class="ranking-worth">{money(worth)}</span>
              </li>
            ))}
          </ol>
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
            Otra mesa
          </button>
          <button type="button" onClick={onHome}>
            Inicio
          </button>
        </div>
      </div>
    </dialog>
  );
}

const icon = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2.2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

function HouseIcon() {
  return (
    <svg {...icon}>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg {...icon}>
      <path d="M4 8h14l-4-4" />
      <path d="M20 16H6l4 4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg {...icon}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...icon}>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}

function SoundIcon({ off }: { off: boolean }) {
  return (
    <svg {...icon}>
      <path d="M4 10v4h4l5 4V6L8 10H4Z" />
      {off ? <path d="m17 9 5 6m0-6-5 6" /> : <path d="M17 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  );
}

function OfflineIcon() {
  return (
    <svg {...icon} width={14} height={14} class="offline-icon">
      <path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
