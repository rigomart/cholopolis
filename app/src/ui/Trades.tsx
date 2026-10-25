import { useState } from "preact/hooks";

import { GROUP_COLORS, square } from "../../../shared/board.ts";
import {
  type Action,
  activePlayers,
  findPlayer,
  money,
  ownedBy,
  type Player,
  type PublicState,
  type Trade,
  type TradeSide,
  tradeSideError,
} from "../../../shared/game.ts";
import { Pawn } from "./bits.tsx";

export function describeSide(side: TradeSide): string {
  const parts = side.squares.map((i) => square(i).name);
  if (side.cash > 0) parts.push(money(side.cash));
  if (side.jailCards > 0)
    parts.push(side.jailCards > 1 ? `${side.jailCards} tarjetas del Penal` : "la tarjeta del Penal");
  return parts.length ? parts.join(", ") : "nada";
}

const emptySide = (): TradeSide => ({ squares: [], cash: 0, jailCards: 0 });

interface ComposerProps {
  state: PublicState;
  me: Player;
  initialPartner: string | null;
  act: (action: Action) => void;
  onClose: () => void;
}

/** Builds an offer: what you give, what you ask for, and who it goes to. */
export function TradeComposer({ state, me, initialPartner, act, onClose }: ComposerProps) {
  const others = activePlayers(state).filter((p) => p.id !== me.id);
  const [partnerId, setPartnerId] = useState(initialPartner ?? others[0]?.id ?? "");
  const [give, setGive] = useState(emptySide);
  const [get, setGet] = useState(emptySide);
  const partner = findPlayer(state, partnerId);

  const pickPartner = (id: string) => {
    setPartnerId(id);
    setGet(emptySide());
  };
  const error = partner ? (tradeSideError(state, me, give) ?? tradeSideError(state, partner, get)) : "Elige con quién.";
  const empty =
    !give.squares.length && !give.cash && !give.jailCards && !get.squares.length && !get.cash && !get.jailCards;

  const submit = (e: Event) => {
    e.preventDefault();
    if (!partner || error || empty) return;
    act({ type: "proposeTrade", to: partner.id, give, get });
    onClose();
  };

  return (
    <aside class="sheet" aria-labelledby="trade-title">
      <header class="sheet-head">
        <h2 id="trade-title">Proponer un trato</h2>
        <button type="button" class="link" onClick={onClose}>
          Cerrar
        </button>
      </header>
      <form onSubmit={submit} class="trade-form">
        <label class="field">
          Con
          <select value={partnerId} onChange={(e) => pickPartner(e.currentTarget.value)}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div class="trade-cols">
          <SidePicker title="Tú das" state={state} owner={me} side={give} onChange={setGive} />
          {partner && (
            <SidePicker title={`${partner.name} te da`} state={state} owner={partner} side={get} onChange={setGet} />
          )}
        </div>
        {error && !empty && <p class="form-error">{error}</p>}
        <button type="submit" class="primary" disabled={Boolean(error) || empty}>
          Enviar oferta
        </button>
      </form>
    </aside>
  );
}

interface SideProps {
  title: string;
  state: PublicState;
  owner: Player;
  side: TradeSide;
  onChange: (side: TradeSide) => void;
}

function SidePicker({ title, state, owner, side, onChange }: SideProps) {
  const owned = ownedBy(state, owner.id);
  const toggle = (i: number) =>
    onChange({
      ...side,
      squares: side.squares.includes(i) ? side.squares.filter((s) => s !== i) : [...side.squares, i],
    });

  return (
    <fieldset class="trade-side">
      <legend>
        <Pawn player={owner} size={14} /> {title}
      </legend>
      {owned.length === 0 && <p class="muted small">Sin propiedades.</p>}
      {owned.map((i) => {
        const sq = square(i);
        const blocked = tradeSideError(state, owner, { squares: [i], cash: 0, jailCards: 0 });
        return (
          <label key={i} class={blocked ? "check disabled" : "check"} title={blocked ?? undefined}>
            <input
              type="checkbox"
              checked={side.squares.includes(i)}
              disabled={Boolean(blocked)}
              onChange={() => toggle(i)}
            />
            <span class="swatch" style={{ background: sq.kind === "street" ? GROUP_COLORS[sq.group] : "#cbbdf5" }} />
            {sq.name}
            {state.props[i]?.mortgaged && <span class="muted small"> (hipotecada)</span>}
          </label>
        );
      })}
      <label class="field">
        Soles
        <input
          type="number"
          min={0}
          max={Math.max(0, owner.cash)}
          step={10}
          value={side.cash}
          onInput={(e) => onChange({ ...side, cash: Math.max(0, Math.floor(Number(e.currentTarget.value) || 0)) })}
        />
      </label>
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
    </fieldset>
  );
}

/** Offers waiting on you, and the one you sent. */
export function TradeOffers({ state, me, act }: { state: PublicState; me: Player; act: (action: Action) => void }) {
  const mine = state.trades.filter((t) => t.to === me.id || t.from === me.id);
  if (!mine.length) return null;
  return (
    <section class="offers" aria-label="Tratos">
      {mine.map((t) => (
        <Offer key={t.id} trade={t} state={state} me={me} act={act} />
      ))}
    </section>
  );
}

function Offer({ trade, state, me, act }: { trade: Trade; state: PublicState; me: Player; act: (a: Action) => void }) {
  const incoming = trade.to === me.id;
  const other = findPlayer(state, incoming ? trade.from : trade.to);
  if (!other) return null;
  return (
    <div class="offer">
      {incoming ? (
        <p>
          <Pawn player={other} size={14} /> <strong>{other.name}</strong> te da {describeSide(trade.give)} a cambio de{" "}
          {describeSide(trade.get)}.
        </p>
      ) : (
        <p>
          Le ofreciste a <strong>{other.name}</strong> {describeSide(trade.give)} por {describeSide(trade.get)}.
        </p>
      )}
      <div class="offer-actions">
        {incoming ? (
          <>
            <button type="button" class="primary" onClick={() => act({ type: "acceptTrade", trade: trade.id })}>
              Aceptar
            </button>
            <button type="button" onClick={() => act({ type: "rejectTrade", trade: trade.id })}>
              Rechazar
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
