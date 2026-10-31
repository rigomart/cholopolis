import {
  BOARD,
  GROUP_COLORS,
  type Group,
  groupSquares,
  isOwnable,
  mortgageValue,
  square,
  squaresOfKind,
} from "../../../shared/board.ts";
import { HOTEL, type PublicState, type Trade, type TradeSide } from "../../../shared/game.ts";

/** A color group, or the transports or the services, as the deal table shows them. */
export interface DealGroup {
  key: Group | "transporte" | "servicio";
  label: string;
  color: string;
  squares: number[];
}

const STREET_LABELS: Record<Group, string> = {
  cafe: "Café",
  celeste: "Celeste",
  rosa: "Rosa",
  naranja: "Naranja",
  rojo: "Rojo",
  amarillo: "Amarillo",
  verde: "Verde",
  azul: "Azul",
};

export const UTILITY_COLOR = "#cbbdf5";

export const DEAL_GROUPS: DealGroup[] = [
  ...(Object.keys(STREET_LABELS) as Group[]).map((key) => ({
    key,
    label: STREET_LABELS[key],
    color: GROUP_COLORS[key],
    squares: groupSquares(key),
  })),
  { key: "transporte", label: "Transportes", color: UTILITY_COLOR, squares: squaresOfKind("station") },
  { key: "servicio", label: "Servicios", color: UTILITY_COLOR, squares: squaresOfKind("utility") },
];

export function dealGroupOf(index: number): DealGroup {
  const group = DEAL_GROUPS.find((g) => g.squares.includes(index));
  if (!group) throw new Error(`${square(index).name} is not ownable`);
  return group;
}

/** How much of the square's group its owner holds, e.g. "2/3 Celeste". */
export function groupProgress(state: PublicState, index: number): string {
  const group = dealGroupOf(index);
  const owner = state.props[index]?.owner;
  const held = group.squares.filter((i) => owner && state.props[i]?.owner === owner).length;
  return `${held}/${group.squares.length} ${group.label}`;
}

/** Why a square can't go into a deal, short enough to print on its card; null once it's on the table. */
export function blockedReason(state: PublicState, index: number, onTable = false): string | null {
  if (onTable) return null;
  const own = state.props[index]?.houses ?? 0;
  if (own === HOTEL) return "tiene hotel";
  if (own > 0) return "tiene casas";
  if (dealGroupOf(index).squares.some((i) => (state.props[i]?.houses ?? 0) > 0)) return "su grupo tiene casas";
  return null;
}

/** A square at its list price, or its mortgage value while mortgaged. */
export function squareValue(state: PublicState, index: number): number {
  const sq = square(index);
  if (!isOwnable(sq)) return 0;
  return state.props[index]?.mortgaged ? mortgageValue(sq) : sq.price;
}

export const sideValue = (state: PublicState, side: TradeSide) =>
  side.squares.reduce((sum, i) => sum + squareValue(state, i), side.cash);

export interface Completion {
  playerId: string;
  group: DealGroup;
}

/** Color groups that someone in the deal would hold whole only once it goes through, yours first. */
export function completions(
  state: PublicState,
  meId: string,
  partnerId: string,
  give: TradeSide,
  get: TradeSide,
): Completion[] {
  const before = state.props.map((p) => p?.owner ?? null);
  const owners = [...before];
  for (const i of give.squares) owners[i] = partnerId;
  for (const i of get.squares) owners[i] = meId;
  const found: Completion[] = [];
  for (const playerId of [meId, partnerId]) {
    for (const group of DEAL_GROUPS.slice(0, 8)) {
      const whole = (o: (string | null)[]) => group.squares.every((i) => o[i] === playerId);
      if (whole(owners) && !whole(before)) found.push({ playerId, group });
    }
  }
  return found;
}

export interface DealDraft {
  partner: string;
  give: TradeSide;
  get: TradeSide;
}

/** An incoming offer seen from the one answering it: their ask is what you give. */
export function counterDraft(trade: Trade): DealDraft {
  return {
    partner: trade.from,
    give: { ...trade.get, squares: [...trade.get.squares] },
    get: { ...trade.give, squares: [...trade.give.squares] },
  };
}

export type BoardTap =
  | { to: "give" }
  | { to: "get" }
  | { to: "partner"; partner: string }
  | { to: "none"; reason: string }
  | null;

/** Where a square tapped on the board goes while the deal table is open. */
export function boardTap(state: PublicState, meId: string, partnerId: string, index: number): BoardTap {
  const sq = BOARD[index];
  if (!sq || !isOwnable(sq)) return null;
  const owner = state.props[index]?.owner;
  if (!owner) return { to: "none", reason: `${sq.name} no tiene dueño.` };
  if (owner === meId) return { to: "give" };
  if (owner === partnerId) return { to: "get" };
  if (state.players.some((p) => p.id === owner && !p.bankrupt)) return { to: "partner", partner: owner };
  return null;
}

/** Whom to ask for a square from its deed: its owner, when that's someone you can trade with. */
export function askableOwner(state: PublicState, you: string | null, index: number): string | null {
  const owner = state.props[index]?.owner;
  const me = state.players.find((p) => p.id === you);
  if (state.phase !== "playing" || !me || me.bankrupt || !owner || owner === me.id) return null;
  return state.players.some((p) => p.id === owner && !p.bankrupt) ? owner : null;
}

export function toggleSquare(side: TradeSide, index: number): TradeSide {
  const squares = side.squares.includes(index)
    ? side.squares.filter((i) => i !== index)
    : [...side.squares, index].sort((a, b) => a - b);
  return { ...side, squares };
}

/** Whole soles between zero and `max`. */
export const clampCash = (cash: number, max: number) => Math.max(0, Math.min(Math.floor(cash), Math.max(0, max)));
