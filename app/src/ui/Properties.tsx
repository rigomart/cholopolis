import { GROUP_COLORS, mortgageValue, square, unmortgageCost } from "../../../shared/board.ts";
import {
  type Action,
  buildError,
  HOTEL,
  money,
  mortgageError,
  ownedBy,
  type Player,
  type PublicState,
  sellError,
  unmortgageError,
} from "../../../shared/game.ts";

interface Props {
  state: PublicState;
  me: Player;
  act: (action: Action) => void;
  onInspect: (index: number) => void;
  onClose: () => void;
}

function buildings(houses: number): string {
  if (houses === HOTEL) return "hotel";
  if (houses === 0) return "";
  return `${houses} casa${houses > 1 ? "s" : ""}`;
}

/** Your deeds, with the build, sell and mortgage actions each one allows right now. */
export function Properties({ state, me, act, onInspect, onClose }: Props) {
  const owned = ownedBy(state, me.id);

  return (
    <aside class="sheet" aria-labelledby="props-title">
      <header class="sheet-head">
        <h2 id="props-title">Mis propiedades</h2>
        <button type="button" class="link" onClick={onClose}>
          Cerrar
        </button>
      </header>
      {me.cash < 0 && <p class="alert">Debes {money(-me.cash)}. Vende casas o hipoteca hasta quedar en cero o más.</p>}
      {owned.length === 0 && <p class="muted">Todavía no tienes propiedades. Cae en una sin dueño y cómprala.</p>}
      <ul class="props">
        {owned.map((i) => {
          const sq = square(i);
          const prop = state.props[i];
          if (!prop || !("price" in sq)) return null;
          const build = buildError(state, me.id, i);
          const sell = sellError(state, me.id, i);
          const mortgage = mortgageError(state, me.id, i);
          const unmortgage = unmortgageError(state, me.id, i);
          const color = sq.kind === "street" ? GROUP_COLORS[sq.group] : "#cbbdf5";
          return (
            <li key={i} class={prop.mortgaged ? "mortgaged" : ""}>
              <span class="swatch" style={{ background: color }} />
              <button type="button" class="prop-name" onClick={() => onInspect(i)}>
                {sq.name}
                <span class="muted small">
                  {prop.mortgaged ? " hipotecada" : buildings(prop.houses) ? ` ${buildings(prop.houses)}` : ""}
                </span>
              </button>
              <div class="prop-actions">
                {sq.kind === "street" && !prop.mortgaged && prop.houses < HOTEL && (
                  <button
                    type="button"
                    disabled={Boolean(build)}
                    title={build ?? undefined}
                    onClick={() => act({ type: "build", square: i })}
                  >
                    {prop.houses === 4 ? "Hotel" : "Casa"} {money(sq.houseCost)}
                  </button>
                )}
                {sq.kind === "street" && prop.houses > 0 && (
                  <button
                    type="button"
                    disabled={Boolean(sell)}
                    title={sell ?? undefined}
                    onClick={() => act({ type: "sell", square: i })}
                  >
                    Vender +{money(sq.houseCost / 2)}
                  </button>
                )}
                {!prop.mortgaged && prop.houses === 0 && (
                  <button
                    type="button"
                    disabled={Boolean(mortgage)}
                    title={mortgage ?? undefined}
                    onClick={() => act({ type: "mortgage", square: i })}
                  >
                    Hipotecar +{money(mortgageValue(sq))}
                  </button>
                )}
                {prop.mortgaged && (
                  <button
                    type="button"
                    disabled={Boolean(unmortgage)}
                    title={unmortgage ?? undefined}
                    onClick={() => act({ type: "unmortgage", square: i })}
                  >
                    Levantar {money(unmortgageCost(sq))}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
