import { useEffect, useState } from "preact/hooks";

import { BOARD, GROUP_COLORS, square, type Square } from "../../../shared/board.ts";
import { ownedBy, type PublicState } from "../../../shared/game.ts";

const SETS = [...new Set(BOARD.flatMap((sq) => (sq.kind === "street" ? [sq.group] : []))), "station", "utility"];

const setOf = (sq: Square) => (sq.kind === "street" ? sq.group : sq.kind);

const MEMBERS = new Map(SETS.map((set) => [set, BOARD.flatMap((sq, i) => (setOf(sq) === set ? [i] : []))]));

/** Swatch colour for an ownable square. */
export function squareColor(sq: Square): string {
  return sq.kind === "street" ? GROUP_COLORS[sq.group] : "#cbbdf5";
}

/** One small pip per property `playerId` owns, grouped by set; complete sets join up, mortgaged ones dim. */
export function Pips({ state, playerId }: { state: PublicState; playerId: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const owned = ownedBy(state, playerId).toSorted(
    (a, b) => SETS.indexOf(setOf(square(a))) - SETS.indexOf(setOf(square(b))) || a - b,
  );
  if (owned.length === 0) return null;
  const complete = new Set(SETS.filter((set) => MEMBERS.get(set)?.every((i) => state.props[i]?.owner === playerId)));
  const sets = owned.map((i) => setOf(square(i)));
  return (
    <span class="pips">
      {owned.map((i, n) => {
        const sq = square(i);
        const set = setOf(sq);
        const mortgaged = state.props[i]?.mortgaged;
        const classes = [
          "pip",
          sq.kind !== "street" && "round",
          complete.has(set) && "set",
          sets[n - 1] !== set && "start",
          sets[n + 1] !== set && "end",
          mortgaged && "mortgaged",
        ];
        return (
          <Pip
            key={i}
            class={classes.filter(Boolean).join(" ")}
            color={squareColor(sq)}
            title={mortgaged ? `${sq.name} (hipotecada)` : sq.name}
            fresh={mounted}
          />
        );
      })}
      <span class="visually-hidden">
        {owned.length} {owned.length === 1 ? "propiedad" : "propiedades"}
      </span>
    </span>
  );
}

function Pip({ class: classes, color, title, fresh }: { class: string; color: string; title: string; fresh: boolean }) {
  const [pop] = useState(fresh);
  return <span class={pop ? `${classes} pop` : classes} style={{ "--pip": color }} title={title} />;
}
