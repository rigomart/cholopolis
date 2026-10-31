import { GROUP_COLORS, mortgageValue, square, STATION_RENTS, unmortgageCost } from "../../../shared/board.ts";
import { findPlayer, money, type PublicState } from "../../../shared/game.ts";
import { Pawn } from "./bits.tsx";

const CORNER_TEXT: Record<string, string> = {
  salida: "Cada vez que pasas o caes aquí cobras S/200.",
  jail: "Si solo caes aquí, estás de visita. Para salir del Penal: saca dobles, paga S/50 de fianza o usa tu tarjeta. Al tercer intento pagas sí o sí.",
  parking: "Descansa con los gatos del parque. Aquí no pasa nada.",
  goToJail: "Vas directo al Penal, sin pasar por Salida ni cobrar.",
};

/** The title deed of a square: what it costs, what it charges, who owns it. */
export function Deed({
  state,
  index,
  onClose,
  onAsk,
}: {
  state: PublicState;
  index: number;
  onClose: () => void;
  /** Opens a deal asking the owner for this square. */
  onAsk?: () => void;
}) {
  const sq = square(index);
  const prop = state.props[index];
  const owner = findPlayer(state, prop?.owner);
  const band =
    sq.kind === "street"
      ? GROUP_COLORS[sq.group]
      : sq.kind === "station" || sq.kind === "utility"
        ? "#cbbdf5"
        : sq.kind === "card" && sq.deck === "suerte"
          ? "#ff7a1a"
          : "#38bdf8";

  return (
    <aside class="deed" aria-label={`Ficha de ${sq.name}`}>
      <header style={{ background: band }}>
        <h3>{sq.name}</h3>
        {sq.kind === "street" && sq.city && <span>{sq.city}</span>}
      </header>
      <div class="deed-body">
        {sq.kind === "street" && (
          <table>
            <tbody>
              <tr>
                <td>Alquiler</td>
                <td>{money(sq.rents[0] ?? 0)}</td>
              </tr>
              <tr>
                <td>Con todo el grupo</td>
                <td>{money((sq.rents[0] ?? 0) * 2)}</td>
              </tr>
              {[1, 2, 3, 4].map((n) => (
                <tr key={n}>
                  <td>
                    Con {n} casa{n > 1 ? "s" : ""}
                  </td>
                  <td>{money(sq.rents[n] ?? 0)}</td>
                </tr>
              ))}
              <tr>
                <td>Con hotel</td>
                <td>{money(sq.rents[5] ?? 0)}</td>
              </tr>
              <tr class="deed-sep">
                <td>Cada casa cuesta</td>
                <td>{money(sq.houseCost)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {sq.kind === "station" && (
          <table>
            <tbody>
              {STATION_RENTS.map((rent, n) => (
                <tr key={rent}>
                  <td>
                    Si el dueño tiene {n + 1} transporte{n ? "s" : ""}
                  </td>
                  <td>{money(rent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sq.kind === "utility" && <p>Con un servicio, el alquiler es 4 veces los dados. Con los dos, 10 veces.</p>}
        {sq.kind === "tax" && <p>Pagas {money(sq.amount)} al banco cuando caes aquí.</p>}
        {sq.kind === "card" && <p>Saca una tarjeta de {sq.name} y haz lo que diga.</p>}
        {CORNER_TEXT[sq.kind] && <p>{CORNER_TEXT[sq.kind]}</p>}

        {"price" in sq && prop && (
          <div class="deed-owner">
            {owner ? (
              <>
                <Pawn player={owner} size={14} /> De {owner.name}
                {prop.mortgaged && <span class="tag">hipotecada</span>}
                {onAsk && (
                  <button type="button" class="deed-ask" onClick={onAsk}>
                    Pedir
                  </button>
                )}
              </>
            ) : (
              <>Sin dueño. Cuesta {money(sq.price)}.</>
            )}
          </div>
        )}
        {"price" in sq && (
          <p class="muted small">
            Hipoteca: recibes {money(mortgageValue(sq))}; levantarla cuesta {money(unmortgageCost(sq))}.
          </p>
        )}
      </div>
      <button type="button" class="deed-close" onClick={onClose} aria-label="Cerrar ficha">
        ×
      </button>
    </aside>
  );
}
