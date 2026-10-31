import "./trades.css";
import { useEffect, useRef, useState } from "preact/hooks";

import { isOwnable, square } from "../../../shared/board.ts";
import {
  type Action,
  activePlayers,
  findPlayer,
  money,
  ownedBy,
  type Player,
  type PublicState,
  spendable,
  type Trade,
  type TradeSide,
  tradeSideError,
} from "../../../shared/game.ts";
import { Pawn } from "./bits.tsx";
import {
  blockedReason,
  boardTap,
  clampCash,
  completions,
  counterDraft,
  DEAL_GROUPS,
  dealGroupOf,
  groupProgress,
  sideValue,
  squareValue,
  toggleSquare,
} from "./deal.ts";

const emptySide = (): TradeSide => ({ squares: [], cash: 0, jailCards: 0 });

/** What opens the deal table: a partner, and sides already on it for a "Pedir" or a counter-offer. */
export interface DealStart {
  partner: string | null;
  give?: TradeSide;
  get?: TradeSide;
  /** The offer this one answers; it is turned down when the counter-offer goes out. */
  counterOf?: number;
}

/** The 3D board, as the deal table and the offers use it. */
export interface BoardLink {
  /** Outlines squares for one source, keeping other sources' outlines; [] clears it. */
  locate: (source: "deal" | "offer", indices: number[]) => void;
  /** Glides the camera to a square. */
  focus: (index: number) => void;
}

/** Takes over taps on the board while the deal table is open; null hands them back. */
export type BoardPick = (handler: ((index: number) => void) | null) => void;

interface ComposerProps {
  state: PublicState;
  me: Player;
  start: DealStart;
  act: (action: Action) => void;
  onClose: () => void;
  board: BoardLink;
  boardPick: BoardPick;
}

const isPhone = () => matchMedia("(max-width: 700px)").matches;
const keyboardFocused = (e: FocusEvent) => (e.currentTarget as Element).matches(":focus-visible");

const TAP_LOCATE_MS = 1800;

/** The deal table: pick a partner, move cards and cash onto the table, see what it adds up to. */
export function TradeComposer({ state, me, start, act, onClose, board, boardPick }: ComposerProps) {
  const others = activePlayers(state).filter((p) => p.id !== me.id);
  const [partnerId, setPartnerId] = useState(start.partner ?? others[0]?.id ?? "");
  const [give, setGive] = useState(start.give ?? emptySide);
  const [get, setGet] = useState(start.get ?? emptySide);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [focusAfterMove, setFocusAfterMove] = useState<number | null>(null);
  const partner = others.find((p) => p.id === partnerId);
  const pending = state.trades.find((t) => t.from === me.id && t.id !== start.counterOf);

  const pickPartner = (id: string, ask: number[] = []) => {
    if (id === partnerId && !ask.length) return;
    setPartnerId(id);
    setGet({ ...emptySide(), squares: ask });
  };

  const move = (index: number) => {
    const name = square(index).name;
    const mine = state.props[index]?.owner === me.id;
    const side = mine ? give : get;
    const placed = side.squares.includes(index);
    (mine ? setGive : setGet)(toggleSquare(side, index));
    // Moving the card out from under the pointer fires no pointerleave.
    setHover(null);
    setFocusAfterMove(index);
    setNote(placed ? `${name} volvió a su sitio.` : `${name} está en la mesa.`);
  };

  const show = (index: number) => {
    setPinned(index);
    if (isPhone()) board.focus(index);
  };

  const pickOnBoard = (index: number) => {
    const tap = boardTap(state, me.id, partnerId, index);
    if (!tap) return;
    setPinned(index);
    if (tap.to === "none") return setNote(tap.reason);
    const blocked = blockedReason(state, index, give.squares.includes(index) || get.squares.includes(index));
    if (blocked) return setNote(`${square(index).name}: ${blocked}.`);
    if (tap.to === "partner") {
      pickPartner(tap.partner, [index]);
      const name = findPlayer(state, tap.partner)?.name;
      return setNote(`${square(index).name} es de ${name}: ahora negocias con ${name}.`);
    }
    move(index);
  };
  useEffect(() => {
    boardPick(pickOnBoard);
    return () => boardPick(null);
  });

  useEffect(() => {
    if (pinned === null) return;
    const id = setTimeout(() => setPinned(null), TAP_LOCATE_MS);
    return () => clearTimeout(id);
  }, [pinned]);

  const focus = hover ?? pinned;
  const shown = peek ? [...give.squares, ...get.squares] : [];
  if (focus !== null && !shown.includes(focus)) shown.push(focus);
  const shownKey = shown.join(",");
  useEffect(() => {
    board.locate("deal", shownKey ? shownKey.split(",").map(Number) : []);
  }, [board, shownKey]);
  useEffect(() => () => board.locate("deal", []), [board]);

  const error = partner ? (tradeSideError(state, me, give) ?? tradeSideError(state, partner, get)) : null;
  const empty =
    !give.squares.length && !give.cash && !give.jailCards && !get.squares.length && !get.cash && !get.jailCards;

  const submit = (e: Event) => {
    e.preventDefault();
    if (!partner || error || empty) return;
    if (start.counterOf !== undefined && state.trades.some((t) => t.id === start.counterOf && t.to === me.id)) {
      act({ type: "rejectTrade", trade: start.counterOf });
    }
    act({ type: "proposeTrade", to: partner.id, give, get });
    onClose();
  };

  const hovers = {
    onEnter: (i: number) => setHover(i),
    onLeave: () => setHover(null),
    focusAfterMove,
  };

  return (
    <aside class={peek ? "sheet deal peek" : "sheet deal"} aria-labelledby="trade-title">
      <header class="sheet-head">
        <h2 id="trade-title">{start.counterOf !== undefined ? "Contraoferta" : "Mesa de negociación"}</h2>
        <div class="deal-head-actions">
          <button
            type="button"
            class="link deal-peek"
            aria-label={peek ? "Volver a la mesa" : undefined}
            onClick={() => setPeek(!peek)}
          >
            {peek ? "Volver" : "Ver tablero"}
          </button>
          <button type="button" class="link" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </header>
      <form onSubmit={submit} class="deal-form">
        <div class="deal-body">
          {others.length === 0 ? (
            <p class="muted">No queda nadie con quien negociar.</p>
          ) : (
            <div class="partner-chips">
              <span class="visually-hidden">Negociar con</span>
              {others.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={p.id === partnerId}
                  class="partner-chip"
                  onClick={() => pickPartner(p.id)}
                >
                  <Pawn player={p} size={16} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          )}

          <OwnerMap
            state={state}
            me={me}
            give={give}
            get={get}
            onEnter={hovers.onEnter}
            onLeave={hovers.onLeave}
            onPick={(i) => {
              show(i);
              const owner = state.props[i]?.owner;
              if (owner && owner !== me.id && owner !== partnerId && others.some((p) => p.id === owner)) {
                pickPartner(owner);
              }
            }}
          />

          {partner && (
            <section class="deal-table" aria-label="La mesa">
              <Pile
                title="Tú das"
                state={state}
                owner={me}
                side={give}
                onChange={setGive}
                onCard={move}
                onShow={show}
                {...hovers}
                hint="Toca tus propiedades o el tablero."
              />
              <span class="deal-swap" aria-hidden="true">
                ⇄
              </span>
              <Pile
                title={`${partner.name} te da`}
                state={state}
                owner={partner}
                side={get}
                onChange={setGet}
                onCard={move}
                onShow={show}
                {...hovers}
                hint={`Toca las propiedades de ${partner.name}.`}
              />
            </section>
          )}

          <div class="holdings-cols">
            <Holdings
              title="Tus propiedades"
              state={state}
              owner={me}
              placed={give.squares}
              onCard={move}
              onShow={show}
              {...hovers}
            />
            {partner && (
              <Holdings
                title={`Propiedades de ${partner.name}`}
                state={state}
                owner={partner}
                placed={get.squares}
                onCard={move}
                onShow={show}
                {...hovers}
              />
            )}
          </div>
        </div>

        <footer class="deal-foot">
          {partner && <DealSummary state={state} me={me} partner={partner} give={give} get={get} />}
          {error && !empty && <p class="form-error">{error}</p>}
          {/* Always there, so screen readers announce each new note. */}
          <output class="deal-note">{error && !empty ? "" : note}</output>
          {pending && !empty && (
            <p class="deal-note">Reemplaza tu oferta a {findPlayer(state, pending.to)?.name ?? "otro jugador"}.</p>
          )}
          <button type="submit" class="primary" disabled={!partner || Boolean(error) || empty}>
            Enviar oferta
          </button>
        </footer>
      </form>
    </aside>
  );
}

interface CardHandlers {
  onCard?: (index: number) => void;
  onShow?: (index: number) => void;
  onEnter: (index: number) => void;
  onLeave: () => void;
  focusAfterMove?: number | null;
}

function MiniDeed({
  state,
  index,
  owner,
  placed = false,
  located = false,
  onCard,
  onShow,
  onEnter,
  onLeave,
  focusAfterMove,
}: CardHandlers & {
  state: PublicState;
  index: number;
  owner: Player | undefined;
  placed?: boolean;
  located?: boolean;
}) {
  const sq = square(index);
  const mortgaged = state.props[index]?.mortgaged;
  const blocked = onCard ? blockedReason(state, index, placed) : null;
  const value = isOwnable(sq) ? money(squareValue(state, index)) : "";
  const self = useRef<HTMLButtonElement>(null);
  const takeFocus = focusAfterMove === index;
  useEffect(() => {
    if (takeFocus) self.current?.focus();
  }, [takeFocus]);
  return (
    <button
      ref={self}
      type="button"
      class={["mini-deed", mortgaged && "mortgaged", blocked && "blocked", located && "located"]
        .filter(Boolean)
        .join(" ")}
      style={{ "--group": dealGroupOf(index).color }}
      disabled={Boolean(blocked)}
      aria-label={blocked ? `${sq.name}, no se puede negociar: ${blocked}` : undefined}
      onPointerEnter={() => onEnter(index)}
      onPointerLeave={onLeave}
      onFocus={(e) => keyboardFocused(e) && onEnter(index)}
      onBlur={onLeave}
      onClick={() => {
        onCard?.(index);
        onShow?.(index);
      }}
    >
      <span class="mini-band">
        <span>{groupProgress(state, index)}</span>
      </span>
      <span class="mini-name">{sq.name}</span>
      {blocked ? (
        <span class="mini-blocked">{blocked}</span>
      ) : (
        <span class="mini-foot">
          <span>{mortgaged ? `hipotecada · ${value}` : value}</span>
          {owner && <Pawn player={owner} size={11} />}
        </span>
      )}
    </button>
  );
}

interface PileProps extends CardHandlers {
  title: string;
  state: PublicState;
  owner: Player;
  side: TradeSide;
  onChange: (side: TradeSide) => void;
  hint: string;
}

function Pile({ title, state, owner, side, onChange, hint, ...cards }: PileProps) {
  const max = Math.max(0, spendable(state, owner.id));
  const setCash = (cash: number) => onChange({ ...side, cash: clampCash(cash, max) });
  return (
    <div class="deal-pile">
      <h3>
        <Pawn player={owner} size={14} /> {title}
      </h3>
      {side.squares.length > 0 ? (
        <div class="mini-grid">
          {side.squares.map((i) => (
            <MiniDeed key={i} state={state} index={i} owner={owner} placed {...cards} />
          ))}
        </div>
      ) : (
        <p class="pile-hint">{hint}</p>
      )}
      <fieldset class="cash-control">
        <legend class="visually-hidden">Soles: {title.toLowerCase()}</legend>
        <button
          type="button"
          onClick={() => setCash(side.cash - 50)}
          disabled={side.cash <= 0}
          aria-label="Quitar S/50"
        >
          −S/50
        </button>
        <label class="cash-input">
          <span>S/</span>
          <input
            type="number"
            min={0}
            max={max}
            step={10}
            value={side.cash}
            aria-label="Soles"
            onInput={(e) => setCash(Number(e.currentTarget.value) || 0)}
          />
        </label>
        {[50, 100, 500].map((n) => (
          <button key={n} type="button" onClick={() => setCash(side.cash + n)} disabled={side.cash >= max}>
            +S/{n}
          </button>
        ))}
        <button type="button" onClick={() => setCash(max)} disabled={side.cash >= max}>
          Todo
        </button>
      </fieldset>
      {owner.jailCards.length > 0 && (
        <label class="check">
          <input
            type="checkbox"
            checked={side.jailCards > 0}
            onChange={(e) => onChange({ ...side, jailCards: e.currentTarget.checked ? 1 : 0 })}
          />
          Tarjeta para salir del Penal
        </label>
      )}
    </div>
  );
}

function Holdings({
  title,
  state,
  owner,
  placed,
  ...cards
}: CardHandlers & { title: string; state: PublicState; owner: Player; placed: number[] }) {
  const owned = new Set(ownedBy(state, owner.id).filter((i) => !placed.includes(i)));
  const groups = DEAL_GROUPS.map((g) => g.squares.filter((i) => owned.has(i))).filter((g) => g.length);
  return (
    <section class="holdings">
      <h3>
        <Pawn player={owner} size={14} /> {title}
      </h3>
      {groups.length === 0 && (
        <p class="pile-hint">{ownedBy(state, owner.id).length ? "Todas están en la mesa." : "Sin propiedades."}</p>
      )}
      {groups.map((squares) => (
        <div key={squares[0]} class="mini-grid">
          {squares.map((i) => (
            <MiniDeed key={i} state={state} index={i} owner={owner} {...cards} />
          ))}
        </div>
      ))}
    </section>
  );
}

function OwnerMap({
  state,
  me,
  give,
  get,
  onEnter,
  onLeave,
  onPick,
}: {
  state: PublicState;
  me: Player;
  give: TradeSide;
  get: TradeSide;
  onEnter: (index: number) => void;
  onLeave: () => void;
  onPick: (index: number) => void;
}) {
  const [open] = useState(() => !isPhone());
  return (
    <details class="owner-map" open={open}>
      <summary>¿De quién es cada calle?</summary>
      <div class="owner-rows">
        {DEAL_GROUPS.map((group) => (
          <div key={group.key} class="owner-row" style={{ "--group": group.color }}>
            <span class="owner-label">{group.label}</span>
            {group.squares.map((i) => {
              const owner = findPlayer(state, state.props[i]?.owner);
              const name = square(i).name;
              const inDeal = give.squares.includes(i) || get.squares.includes(i);
              const whose = owner ? (owner.id === me.id ? "tuya" : `de ${owner.name}`) : "sin dueño";
              return (
                <button
                  key={i}
                  type="button"
                  class={inDeal ? "owner-slot in-deal" : "owner-slot"}
                  title={`${name}, ${whose}`}
                  aria-label={`${name}, ${whose}${inDeal ? ", en la mesa" : ""}`}
                  onPointerEnter={() => onEnter(i)}
                  onPointerLeave={onLeave}
                  onFocus={() => onEnter(i)}
                  onBlur={onLeave}
                  onClick={() => onPick(i)}
                >
                  {owner && <Pawn player={owner} size={12} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </details>
  );
}

function DealSummary({
  state,
  me,
  partner,
  give,
  get,
}: {
  state: PublicState;
  me: Player;
  partner: Player;
  give: TradeSide;
  get: TradeSide;
}) {
  const badges = completions(state, me.id, partner.id, give, get);
  return (
    <div class="deal-summary">
      <p class="deal-totals">
        <span>
          Das <strong>{money(sideValue(state, give))}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Recibes <strong>{money(sideValue(state, get))}</strong>
        </span>
      </p>
      {badges.length > 0 && (
        <ul class="deal-badges">
          {badges.map(({ playerId, group }) => (
            <li
              key={`${playerId}:${group.key}`}
              class={playerId === me.id ? "badge good" : "badge warn"}
              style={{ "--group": group.color }}
            >
              {playerId === me.id ? `¡Completas ${group.label}!` : `⚠️ ${partner.name} completa ${group.label}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface OffersProps {
  state: PublicState;
  me: Player;
  act: (action: Action) => void;
  onCounter: (start: DealStart) => void;
  board: BoardLink;
}

/** Offers waiting on you, and the one you sent. */
export function TradeOffers({ state, me, act, onCounter, board }: OffersProps) {
  const mine = state.trades.filter((t) => t.to === me.id || t.from === me.id);
  const [hover, setHover] = useState<number | null>(null);
  const [tapped, setTapped] = useState<number | null>(null);
  // A card removed with its offer never fires pointerleave.
  const onOffer = new Set(mine.flatMap((t) => [...t.give.squares, ...t.get.squares]));
  const focus = [hover, tapped].find((i) => i !== null && onOffer.has(i)) ?? null;
  useEffect(() => {
    if (focus === null) return;
    board.locate("offer", [focus]);
    return () => board.locate("offer", []);
  }, [focus, board]);
  useEffect(() => {
    if (tapped === null) return;
    const id = setTimeout(() => setTapped(null), TAP_LOCATE_MS);
    return () => clearTimeout(id);
  }, [tapped]);
  if (!mine.length) return null;
  const cards: Locating = {
    focus,
    onEnter: setHover,
    onLeave: () => setHover(null),
    onShow: (i) => {
      setTapped(i === tapped ? null : i);
      if (isPhone() && i !== tapped) board.focus(i);
    },
  };
  return (
    <section class={focus === null ? "offers" : "offers locating"} aria-label="Tratos">
      {mine.map((t) => (
        <Offer key={t.id} trade={t} state={state} me={me} act={act} onCounter={onCounter} cards={cards} />
      ))}
    </section>
  );
}

type Locating = Omit<CardHandlers, "onCard"> & { focus: number | null };

function Offer({
  trade,
  state,
  me,
  act,
  onCounter,
  cards,
}: {
  trade: Trade;
  state: PublicState;
  me: Player;
  act: (a: Action) => void;
  onCounter: (start: DealStart) => void;
  cards: Locating;
}) {
  const incoming = trade.to === me.id;
  const other = findPlayer(state, incoming ? trade.from : trade.to);
  if (!other) return null;
  const { give, get } = incoming ? counterDraft(trade) : trade;
  return (
    <div class={incoming ? "offer incoming" : "offer"}>
      <p class="offer-title">
        <Pawn player={other} size={14} />{" "}
        {incoming ? (
          <>
            <strong>{other.name}</strong> te propone un trato
          </>
        ) : (
          <>
            Le ofreciste un trato a <strong>{other.name}</strong>
          </>
        )}
      </p>
      <div class="offer-sides">
        <OfferSide title="Recibes" state={state} side={get} owner={other} cards={cards} />
        <OfferSide title="Das" state={state} side={give} owner={me} cards={cards} />
      </div>
      <DealSummary state={state} me={me} partner={other} give={give} get={get} />
      <div class="offer-actions">
        {incoming ? (
          <>
            <button type="button" class="primary" onClick={() => act({ type: "acceptTrade", trade: trade.id })}>
              Aceptar
            </button>
            <button type="button" onClick={() => act({ type: "rejectTrade", trade: trade.id })}>
              Rechazar
            </button>
            <button type="button" onClick={() => onCounter({ ...counterDraft(trade), counterOf: trade.id })}>
              Contraofertar
            </button>
          </>
        ) : (
          <button type="button" onClick={() => act({ type: "cancelTrade", trade: trade.id })}>
            Retirar oferta
          </button>
        )}
      </div>
    </div>
  );
}

function OfferSide({
  title,
  state,
  side,
  owner,
  cards,
}: {
  title: string;
  state: PublicState;
  side: TradeSide;
  owner: Player;
  cards: Locating;
}) {
  const jail = side.jailCards > 1 ? `${side.jailCards} tarjetas del Penal` : "Tarjeta del Penal";
  return (
    <div class="offer-side">
      <h4>{title}</h4>
      <div class="mini-grid">
        {side.squares.map((i) => (
          <MiniDeed
            key={i}
            state={state}
            index={i}
            owner={owner}
            located={cards.focus === i}
            onEnter={cards.onEnter}
            onLeave={cards.onLeave}
            onShow={cards.onShow}
          />
        ))}
        {side.cash > 0 && <span class="cash-chip">{money(side.cash)}</span>}
        {side.jailCards > 0 && <span class="cash-chip">{jail}</span>}
        {!side.squares.length && !side.cash && !side.jailCards && <span class="pile-hint">nada</span>}
      </div>
    </div>
  );
}
