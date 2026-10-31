import {
  BOARD,
  type Deck,
  groupSquares,
  HOTEL_SUPPLY,
  HOUSE_SUPPLY,
  isOwnable,
  JAIL_FINE,
  JAIL_SQUARE,
  MAX_PLAYERS,
  mortgageValue,
  SALIDA_BONUS,
  square,
  squaresOfKind,
  STARTING_CASH,
  STATION_RENTS,
  unmortgageCost,
} from "./board.ts";
import { CARDS } from "./cards.ts";
import { type DiceToss, parseDiceToss } from "./dice.ts";
import { PIECES } from "./pieces.ts";

export const PLAYER_COLORS = [
  "#ff2e88",
  "#ffd400",
  "#19d36b",
  "#19b8ff",
  "#ff7a00",
  "#9b5cff",
  "#f4f1e8",
  "#2b2b33",
] as const;

/** A house count of 5 is a hotel. */
export const HOTEL = 5;
const LOG_LIMIT = 80;
const TRADE_LIMIT_PER_PLAYER = 1;
/** Turns timed out while disconnected before the seat is given up. */
const ABANDON_AFTER_TURNS = 3;

export type Rng = () => number;
export type Stage = "roll" | "buy" | "done";

export interface Player {
  id: string;
  name: string;
  color: number;
  /** Index into PIECES. */
  piece: number;
  position: number;
  cash: number;
  inJail: boolean;
  jailTurns: number;
  /** Decks the held "Sal libre del Penal" cards came from, so they go back to the right one. */
  jailCards: Deck[];
  bankrupt: boolean;
  /**
   * What was left unpaid, oldest first, when payments pushed cash below zero. Read it with
   * `debtsOf`: only the part still matching a negative balance counts.
   */
  debts: Debt[];
  connected: boolean;
  /** Turns of theirs in a row that timed out while they were disconnected. */
  idleTurns: number;
}

/** Money owed to a player, or to the bank when `to` is null. */
export interface Debt {
  to: string | null;
  amount: number;
}

export interface Property {
  owner: string | null;
  houses: number;
  mortgaged: boolean;
}

export interface TradeSide {
  squares: number[];
  cash: number;
  jailCards: number;
}

export interface Trade {
  id: number;
  from: string;
  to: string;
  /** What `from` hands over. */
  give: TradeSide;
  /** What `from` asks for in return. */
  get: TradeSide;
}

export interface Turn {
  playerId: string;
  stage: Stage;
  doubles: number;
  rolledDoubles: boolean;
  /** Set once the clock has run out on this turn. */
  timedOut?: boolean;
}

/** One piece movement, so clients can animate a walk along the board or a jump straight to the Penal. */
export interface Move {
  id: number;
  playerId: string;
  from: number;
  to: number;
  /** Squares walked (negative walks backwards); null jumps. */
  steps: number | null;
}

export interface LogEntry {
  id: number;
  text: string;
}

export interface DrawnCard {
  id: number;
  deck: Deck;
  text: string;
  playerId: string;
}

export interface GameState {
  phase: "lobby" | "playing" | "ended";
  hostId: string | null;
  players: Player[];
  /** Indexed by square; null for squares nobody can own. */
  props: (Property | null)[];
  turn: Turn | null;
  dice: [number, number] | null;
  rollId: number;
  /**
   * How the dice left the hand. Not called `toss`, the older shape's name, so tabs still
   * running that client ignore it and fall back to their own automatic throw.
   */
  diceToss: DiceToss | null;
  card: DrawnCard | null;
  moves: Move[];
  trades: Trade[];
  log: LogEntry[];
  winnerId: string | null;
  /** When the current turn times out (epoch ms); set by the server. */
  deadline: number | null;
  nextId: number;
  /** Card order; server-only, never sent to clients. */
  decks: Record<Deck, number[]>;
}

export type PublicState = Omit<GameState, "decks">;

export type Action =
  | { type: "start" }
  | { type: "choosePiece"; piece: number }
  | { type: "roll"; diceToss?: DiceToss; rollId?: number }
  | { type: "buy" }
  | { type: "decline" }
  | { type: "endTurn" }
  | { type: "payJailFine" }
  | { type: "useJailCard" }
  | { type: "build"; square: number }
  | { type: "sell"; square: number }
  | { type: "mortgage"; square: number }
  | { type: "unmortgage"; square: number }
  | { type: "proposeTrade"; to: string; give: TradeSide; get: TradeSide }
  | { type: "acceptTrade"; trade: number }
  | { type: "rejectTrade"; trade: number }
  | { type: "cancelTrade"; trade: number }
  | { type: "bankrupt" };

/** A rule violation, worded for the player who tried it. */
export class GameError extends Error {}

function fail(message: string): never {
  throw new GameError(message);
}

export function createGame(): GameState {
  return {
    phase: "lobby",
    hostId: null,
    players: [],
    props: BOARD.map((sq) => (isOwnable(sq) ? { owner: null, houses: 0, mortgaged: false } : null)),
    turn: null,
    dice: null,
    rollId: 0,
    diceToss: null,
    card: null,
    moves: [],
    trades: [],
    log: [],
    winnerId: null,
    deadline: null,
    nextId: 1,
    decks: { suerte: [], caja: [] },
  };
}

/** A game as saved by any version: dice data this one can't replay is dropped. */
export function restoreGame(saved: GameState): GameState {
  const { toss: _legacy, ...g } = saved as GameState & { toss?: unknown };
  return { ...g, diceToss: parseDiceToss(g.diceToss), players: g.players.map(restorePlayer) };
}

/** Fills what older saves lack; a single `creditor` becomes the debt it stood for. */
function restorePlayer(saved: Player): Player {
  const { creditor, ...p } = saved as Player & { creditor?: string | null };
  return {
    ...p,
    debts: p.debts ?? (p.cash < 0 ? [{ to: creditor ?? null, amount: -p.cash }] : []),
    idleTurns: p.idleTurns ?? 0,
  };
}

export function toPublic(g: GameState): PublicState {
  const { decks: _decks, ...rest } = g;
  return rest;
}

export const money = (n: number) => `S/${n.toLocaleString("es-PE")}`;

// ---------------------------------------------------------------- lookups

export function findPlayer(g: PublicState, id: string | null | undefined): Player | undefined {
  return g.players.find((p) => p.id === id);
}

function player(g: GameState, id: string): Player {
  return findPlayer(g, id) ?? fail("No estás en esta mesa.");
}

export function activePlayers(g: PublicState): Player[] {
  return g.players.filter((p) => !p.bankrupt);
}

export function debtors(g: PublicState): Player[] {
  return activePlayers(g).filter((p) => p.cash < 0);
}

/**
 * Who a negative balance is owed to, one entry per creditor in the order they were first left
 * unpaid, adding up to the balance. Cash won back since clears the oldest debts first.
 */
export function debtsOf(p: Player): Debt[] {
  let excess = p.debts.reduce((sum, d) => sum + d.amount, 0) - Math.max(0, -p.cash);
  const owed = new Map<string | null, number>();
  for (const d of p.debts) {
    const cleared = Math.min(d.amount, Math.max(0, excess));
    excess -= cleared;
    if (d.amount > cleared) owed.set(d.to, (owed.get(d.to) ?? 0) + d.amount - cleared);
  }
  return [...owed].map(([to, amount]) => ({ to, amount }));
}

/** Cash a player can use: what they hold minus payments from debtors who could not cover them. */
function spendable(g: PublicState, id: string): number {
  let cash = findPlayer(g, id)?.cash ?? 0;
  for (const d of debtors(g)) for (const owed of debtsOf(d)) if (owed.to === id) cash -= owed.amount;
  return cash;
}

/** The creditor owed the most, who inherits a bankrupt debtor; null is the bank. */
export function mainCreditor(p: Player): string | null {
  let best: Debt | undefined;
  for (const d of debtsOf(p)) if (!best || d.amount > best.amount) best = d;
  return best?.to ?? null;
}

export function canDragDice(g: PublicState, playerId: string | null, rollId: number): boolean {
  const p = findPlayer(g, playerId);
  return (
    g.phase === "playing" &&
    g.turn?.stage === "roll" &&
    g.turn.playerId === playerId &&
    g.rollId === rollId &&
    Boolean(p?.connected && !p.bankrupt) &&
    debtors(g).length === 0
  );
}

function prop(g: PublicState, index: number): Property {
  return g.props[index] ?? fail("Esa casilla no se puede comprar.");
}

export function ownedBy(g: PublicState, playerId: string): number[] {
  return g.props.flatMap((p, i) => (p?.owner === playerId ? [i] : []));
}

export function ownsGroup(g: PublicState, playerId: string, index: number): boolean {
  const sq = square(index);
  if (sq.kind !== "street") return false;
  return groupSquares(sq.group).every((i) => g.props[i]?.owner === playerId);
}

function groupOf(index: number): number[] {
  const sq = square(index);
  return sq.kind === "street" ? groupSquares(sq.group) : [index];
}

export function buildingsInUse(g: PublicState): { houses: number; hotels: number } {
  let houses = 0;
  let hotels = 0;
  for (const p of g.props) {
    if (!p) continue;
    if (p.houses === HOTEL) hotels++;
    else houses += p.houses;
  }
  return { houses, hotels };
}

export interface RentModifiers {
  stationMultiplier?: number;
  utilityTimes10?: boolean;
}

export function rentFor(g: PublicState, index: number, diceTotal: number, mods: RentModifiers = {}): number {
  const sq = square(index);
  const p = prop(g, index);
  if (!p.owner || p.mortgaged) return 0;
  const owner = p.owner;
  switch (sq.kind) {
    case "street": {
      const rent = sq.rents[p.houses] ?? 0;
      return p.houses === 0 && ownsGroup(g, owner, index) ? rent * 2 : rent;
    }
    case "station": {
      const count = squaresOfKind("station").filter((i) => g.props[i]?.owner === owner).length;
      return (STATION_RENTS[count - 1] ?? 0) * (mods.stationMultiplier ?? 1);
    }
    case "utility": {
      const count = squaresOfKind("utility").filter((i) => g.props[i]?.owner === owner).length;
      return diceTotal * (mods.utilityTimes10 || count === 2 ? 10 : 4);
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------- validators shared with the client

/** Why `playerId` cannot build on `index` right now, or null if they can. */
export function buildError(g: PublicState, playerId: string, index: number): string | null {
  const sq = square(index);
  const p = g.props[index];
  if (sq.kind !== "street" || !p) return "Solo se construye en avenidas.";
  if (p.owner !== playerId) return "No es tuya.";
  if (!ownsGroup(g, playerId, index)) return "Necesitas todo el grupo de color.";
  const group = groupSquares(sq.group);
  if (group.some((i) => g.props[i]?.mortgaged)) return "Hay una propiedad hipotecada en el grupo.";
  if (p.houses >= HOTEL) return "Ya tiene hotel.";
  if (p.houses > Math.min(...group.map((i) => g.props[i]?.houses ?? 0))) return "Construye parejo en el grupo.";
  const cash = spendable(g, playerId);
  if (cash < sq.houseCost) return `Necesitas ${money(sq.houseCost)}.`;
  const used = buildingsInUse(g);
  if (p.houses === 4 && used.hotels >= HOTEL_SUPPLY) return "El banco no tiene hoteles.";
  if (p.houses < 4 && used.houses >= HOUSE_SUPPLY) return "El banco no tiene casas.";
  return null;
}

export function sellError(g: PublicState, playerId: string, index: number): string | null {
  const sq = square(index);
  const p = g.props[index];
  if (sq.kind !== "street" || !p) return "Solo hay edificios en avenidas.";
  if (p.owner !== playerId) return "No es tuya.";
  if (p.houses === 0) return "No tiene edificios.";
  const group = groupSquares(sq.group);
  if (p.houses < Math.max(...group.map((i) => g.props[i]?.houses ?? 0))) return "Vende parejo en el grupo.";
  if (p.houses === HOTEL && buildingsInUse(g).houses + 4 > HOUSE_SUPPLY) {
    return "El banco no tiene casas para cambiar el hotel.";
  }
  return null;
}

export function mortgageError(g: PublicState, playerId: string, index: number): string | null {
  const p = g.props[index];
  if (!p) return "Esa casilla no se puede hipotecar.";
  if (p.owner !== playerId) return "No es tuya.";
  if (p.mortgaged) return "Ya está hipotecada.";
  if (groupOf(index).some((i) => (g.props[i]?.houses ?? 0) > 0)) return "Primero vende los edificios del grupo.";
  return null;
}

export function unmortgageError(g: PublicState, playerId: string, index: number): string | null {
  const sq = square(index);
  const p = g.props[index];
  if (!p || !isOwnable(sq)) return "Esa casilla no se puede hipotecar.";
  if (p.owner !== playerId) return "No es tuya.";
  if (!p.mortgaged) return "No está hipotecada.";
  const cash = spendable(g, playerId);
  if (cash < unmortgageCost(sq)) return `Necesitas ${money(unmortgageCost(sq))}.`;
  return null;
}

export function tradeSideError(g: PublicState, owner: Player, side: TradeSide): string | null {
  if (new Set(side.squares).size !== side.squares.length) return "Propiedad repetida.";
  for (const i of side.squares) {
    const p = g.props[i];
    if (!p || p.owner !== owner.id) return `${square(i).name} no es de ${owner.name}.`;
    if (groupOf(i).some((j) => (g.props[j]?.houses ?? 0) > 0)) {
      return `${square(i).name} tiene edificios en su grupo.`;
    }
  }
  if (!Number.isInteger(side.cash) || side.cash < 0) return "Monto inválido.";
  if (side.cash > Math.max(0, spendable(g, owner.id))) return `${owner.name} no tiene ${money(side.cash)}.`;
  if (side.jailCards > owner.jailCards.length) return `${owner.name} no tiene esa tarjeta.`;
  return null;
}

const isEmptySide = (s: TradeSide) => s.squares.length === 0 && s.cash === 0 && s.jailCards === 0;

function tradeError(g: PublicState, t: Omit<Trade, "id">): string | null {
  const from = findPlayer(g, t.from);
  const to = findPlayer(g, t.to);
  if (!from || !to || from.bankrupt || to.bankrupt) return "Ese jugador ya no está.";
  if (from.id === to.id) return "No puedes negociar contigo.";
  if (isEmptySide(t.give) && isEmptySide(t.get)) return "El trato está vacío.";
  return tradeSideError(g, from, t.give) ?? tradeSideError(g, to, t.get);
}

// ---------------------------------------------------------------- lobby

export function addPlayer(g: GameState, id: string, rawName: string): Player {
  if (g.phase !== "lobby") fail("La partida ya empezó.");
  const existing = findPlayer(g, id);
  if (existing) return existing;
  if (g.players.length >= MAX_PLAYERS) {
    // A seat held by someone who closed the tab goes to whoever is actually here.
    const idle = g.players.findIndex((p) => !p.connected);
    if (idle === -1) fail("La mesa está llena.");
    g.players.splice(idle, 1);
  }
  const used = new Set(g.players.map((p) => p.color));
  const color = PLAYER_COLORS.findIndex((_, i) => !used.has(i));
  const usedPieces = new Set(g.players.map((p) => p.piece));
  const piece = PIECES.findIndex((_, i) => !usedPieces.has(i));
  const p: Player = {
    id,
    name: uniqueName(g, rawName),
    color,
    piece,
    position: 0,
    cash: STARTING_CASH,
    inJail: false,
    jailTurns: 0,
    jailCards: [],
    bankrupt: false,
    debts: [],
    connected: true,
    idleTurns: 0,
  };
  g.players.push(p);
  g.hostId ??= id;
  log(g, `${p.name} se unió a la mesa.`);
  return p;
}

export function removePlayer(g: GameState, id: string): void {
  if (g.phase !== "lobby") return;
  const p = findPlayer(g, id);
  if (!p) return;
  g.players = g.players.filter((x) => x.id !== id);
  if (g.hostId === id) g.hostId = g.players.find((x) => x.connected)?.id ?? g.players[0]?.id ?? null;
  log(g, `${p.name} se fue.`);
}

/** Marks who has an open connection; in the lobby, hands the host role to someone present. */
export function syncPresence(g: GameState, connected: Set<string>): void {
  for (const p of g.players) {
    p.connected = connected.has(p.id);
    if (p.connected) p.idleTurns = 0;
  }
  if (g.phase === "lobby" && !findPlayer(g, g.hostId)?.connected) {
    g.hostId = g.players.find((p) => p.connected)?.id ?? g.hostId;
  }
}

export function cleanName(raw: string): string {
  return (
    raw
      .replace(/[\p{C}<>]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20) || "Anónimo"
  );
}

function uniqueName(g: GameState, raw: string): string {
  const base = cleanName(raw);
  const taken = new Set(g.players.map((p) => p.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}

// ---------------------------------------------------------------- actions

export function act(g: GameState, playerId: string, action: Action, rng: Rng): void {
  g.moves = [];
  if (action.type === "start") return start(g, playerId, rng);
  if (action.type === "choosePiece") return choosePiece(g, playerId, action.piece);
  if (g.phase !== "playing") fail("La partida no está en curso.");
  const p = player(g, playerId);
  if (p.bankrupt) fail("Estás en quiebra.");
  p.idleTurns = 0;

  switch (action.type) {
    case "roll":
      if (action.rollId !== undefined && action.rollId !== g.rollId) fail("Ya tiraste esos dados.");
      return roll(g, p, rng, action.diceToss);
    case "buy":
      return buy(g, p);
    case "decline": {
      requireTurn(g, p, "buy");
      log(g, `${p.name} no compró ${square(p.position).name}.`);
      return finishLanding(g);
    }
    case "endTurn":
      requireTurn(g, p, "done");
      return advanceTurn(g);
    case "payJailFine": {
      requireTurn(g, p, "roll");
      if (!p.inJail) fail("No estás en el Penal.");
      if (p.cash < JAIL_FINE) fail(`Necesitas ${money(JAIL_FINE)}.`);
      pay(g, p, JAIL_FINE, null, "fianza");
      leaveJail(p);
      return;
    }
    case "useJailCard": {
      requireTurn(g, p, "roll");
      if (!p.inJail) fail("No estás en el Penal.");
      const deck = p.jailCards.pop() ?? fail("No tienes esa tarjeta.");
      returnJailCard(g, deck);
      log(g, `${p.name} usó su tarjeta para salir del Penal.`);
      leaveJail(p);
      return;
    }
    case "build":
      return build(g, p, action.square);
    case "sell":
      return sell(g, p, action.square);
    case "mortgage":
      return mortgage(g, p, action.square);
    case "unmortgage": {
      check(unmortgageError(g, p.id, action.square));
      const sq = square(action.square);
      if (!isOwnable(sq)) return;
      prop(g, action.square).mortgaged = false;
      p.cash -= unmortgageCost(sq);
      log(g, `${p.name} levantó la hipoteca de ${sq.name}.`);
      return;
    }
    case "proposeTrade":
      return proposeTrade(g, p, action);
    case "acceptTrade":
      return acceptTrade(g, p, action.trade);
    case "rejectTrade": {
      const t = g.trades.find((x) => x.id === action.trade && x.to === p.id) ?? fail("Ese trato ya no existe.");
      g.trades = g.trades.filter((x) => x !== t);
      log(g, `${p.name} rechazó el trato de ${findPlayer(g, t.from)?.name ?? "alguien"}.`);
      return;
    }
    case "cancelTrade":
      g.trades = g.trades.filter((x) => !(x.id === action.trade && x.from === p.id));
      return;
    case "bankrupt":
      return goBankrupt(g, p);
  }
}

function check(error: string | null): void {
  if (error) fail(error);
}

function choosePiece(g: GameState, playerId: string, piece: number): void {
  if (g.phase !== "lobby") fail("La ficha se elige antes de empezar.");
  const p = player(g, playerId);
  if (!PIECES[piece]) fail("Esa ficha no existe.");
  const holder = g.players.find((x) => x.piece === piece && x.id !== playerId);
  if (holder) fail(`${holder.name} ya tiene esa ficha.`);
  p.piece = piece;
}

function start(g: GameState, playerId: string, rng: Rng): void {
  if (g.phase !== "lobby") fail("La partida ya empezó.");
  if (g.hostId !== playerId) fail("Solo quien abrió la mesa puede empezar.");
  const present = g.players.filter((p) => p.connected);
  if (present.length < 2) fail("Se necesitan al menos 2 jugadores.");
  g.players = shuffle(present, rng);
  g.decks = { suerte: shuffle([...CARDS.suerte.keys()], rng), caja: shuffle([...CARDS.caja.keys()], rng) };
  g.phase = "playing";
  log(g, `¡Empieza la partida! Orden: ${g.players.map((p) => p.name).join(", ")}.`);
  const first = g.players[0];
  if (first) beginTurn(g, first);
}

function requireTurn(g: GameState, p: Player, stage: Stage): Turn {
  const t = g.turn;
  if (!t || t.playerId !== p.id) fail("No es tu turno.");
  const owing = debtors(g);
  if (owing.length > 0) fail(`Primero ${owing.map((d) => d.name).join(", ")} debe saldar sus deudas.`);
  if (t.stage !== stage) {
    fail(t.stage === "buy" ? "Decide si compras." : t.stage === "roll" ? "Tira los dados." : "Termina tu turno.");
  }
  return t;
}

function roll(g: GameState, p: Player, rng: Rng, toss?: DiceToss): void {
  const t = requireTurn(g, p, "roll");
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  const total = d1 + d2;
  const doubles = d1 === d2;
  g.dice = [d1, d2];
  // Cosmetic only: one that doesn't parse is dropped rather than refusing the roll.
  g.diceToss = parseDiceToss(toss);
  g.rollId++;
  log(g, `${p.name} sacó ${d1} y ${d2}${doubles ? " (¡dobles!)" : ""}.`);
  t.rolledDoubles = false;

  if (p.inJail) {
    if (doubles) {
      log(g, `${p.name} sale del Penal con dobles.`);
      leaveJail(p);
    } else if (++p.jailTurns >= 3) {
      pay(g, p, JAIL_FINE, null, "fianza obligatoria");
      leaveJail(p);
    } else {
      t.stage = "done";
      return;
    }
  } else if (doubles) {
    t.rolledDoubles = true;
    if (++t.doubles === 3) {
      log(g, `Tres dobles seguidos: ${p.name} va al Penal por exceso de velocidad.`);
      sendToJail(g, p);
      return;
    }
  }

  walk(g, p, total);
  land(g, p, total);
  if (t.stage !== "buy") finishLanding(g);
}

function finishLanding(g: GameState): void {
  const t = g.turn;
  if (!t) return;
  t.stage = t.rolledDoubles ? "roll" : "done";
}

function buy(g: GameState, p: Player): void {
  requireTurn(g, p, "buy");
  const sq = square(p.position);
  if (!isOwnable(sq)) fail("Aquí no hay nada que comprar.");
  if (p.cash < sq.price) fail(`No te alcanza: cuesta ${money(sq.price)}.`);
  p.cash -= sq.price;
  prop(g, p.position).owner = p.id;
  log(g, `${p.name} compró ${sq.name} por ${money(sq.price)}.`);
  finishLanding(g);
}

function build(g: GameState, p: Player, index: number): void {
  check(buildError(g, p.id, index));
  const sq = square(index);
  if (sq.kind !== "street") return;
  const pr = prop(g, index);
  pr.houses++;
  p.cash -= sq.houseCost;
  log(g, `${p.name} construyó ${pr.houses === HOTEL ? "un hotel" : "una casa"} en ${sq.name}.`);
}

function sell(g: GameState, p: Player, index: number): void {
  check(sellError(g, p.id, index));
  const sq = square(index);
  if (sq.kind !== "street") return;
  const pr = prop(g, index);
  const wasHotel = pr.houses === HOTEL;
  pr.houses--;
  p.cash += sq.houseCost / 2;
  log(g, `${p.name} vendió ${wasHotel ? "un hotel" : "una casa"} de ${sq.name} por ${money(sq.houseCost / 2)}.`);
}

function mortgage(g: GameState, p: Player, index: number): void {
  check(mortgageError(g, p.id, index));
  const sq = square(index);
  if (!isOwnable(sq)) return;
  prop(g, index).mortgaged = true;
  p.cash += mortgageValue(sq);
  log(g, `${p.name} hipotecó ${sq.name} por ${money(mortgageValue(sq))}.`);
}

function proposeTrade(g: GameState, p: Player, a: Extract<Action, { type: "proposeTrade" }>): void {
  const draft = { from: p.id, to: a.to, give: a.give, get: a.get };
  check(tradeError(g, draft));
  const mine = g.trades.filter((t) => t.from === p.id);
  if (mine.length >= TRADE_LIMIT_PER_PLAYER) g.trades = g.trades.filter((t) => t.from !== p.id);
  g.trades.push({ id: g.nextId++, ...draft });
  log(g, `${p.name} le propuso un trato a ${findPlayer(g, a.to)?.name}.`);
}

function acceptTrade(g: GameState, p: Player, id: number): void {
  const t = g.trades.find((x) => x.id === id && x.to === p.id) ?? fail("Ese trato ya no existe.");
  check(tradeError(g, t));
  const from = player(g, t.from);
  for (const i of t.give.squares) prop(g, i).owner = p.id;
  for (const i of t.get.squares) prop(g, i).owner = from.id;
  from.cash += t.get.cash - t.give.cash;
  p.cash += t.give.cash - t.get.cash;
  p.jailCards.push(...from.jailCards.splice(0, t.give.jailCards));
  from.jailCards.push(...p.jailCards.splice(0, t.get.jailCards));
  g.trades = g.trades.filter((x) => x !== t);
  log(g, `${p.name} aceptó el trato con ${from.name}.`);
  // Trades that relied on what just changed hands can no longer go through.
  g.trades = g.trades.filter((x) => tradeError(g, x) === null);
}

// ---------------------------------------------------------------- movement and landing

function beginTurn(g: GameState, p: Player): void {
  g.turn = { playerId: p.id, stage: "roll", doubles: 0, rolledDoubles: false };
  log(g, `Turno de ${p.name}.`);
}

function advanceTurn(g: GameState): void {
  const current = g.players.findIndex((p) => p.id === g.turn?.playerId);
  for (let step = 1; step <= g.players.length; step++) {
    const next = g.players[(current + step) % g.players.length];
    if (next && !next.bankrupt) return beginTurn(g, next);
  }
}

function walk(g: GameState, p: Player, steps: number): void {
  const from = p.position;
  p.position = (((from + steps) % 40) + 40) % 40;
  g.moves.push({ id: g.nextId++, playerId: p.id, from, to: p.position, steps });
  if (steps > 0 && p.position < from) {
    p.cash += SALIDA_BONUS;
    log(g, `${p.name} pasó por Salida y cobró ${money(SALIDA_BONUS)}.`);
  }
}

function walkTo(g: GameState, p: Player, target: number): void {
  walk(g, p, (target - p.position + 40) % 40);
}

function sendToJail(g: GameState, p: Player): void {
  g.moves.push({ id: g.nextId++, playerId: p.id, from: p.position, to: JAIL_SQUARE, steps: null });
  p.position = JAIL_SQUARE;
  p.inJail = true;
  p.jailTurns = 0;
  log(g, `${p.name} fue al Penal.`);
  if (g.turn?.playerId === p.id) {
    g.turn.rolledDoubles = false;
    g.turn.stage = "done";
  }
}

function leaveJail(p: Player): void {
  p.inJail = false;
  p.jailTurns = 0;
}

function land(g: GameState, p: Player, diceTotal: number, mods: RentModifiers = {}): void {
  const index = p.position;
  const sq = square(index);
  switch (sq.kind) {
    case "street":
    case "station":
    case "utility": {
      const pr = prop(g, index);
      if (!pr.owner) {
        if (g.turn) g.turn.stage = "buy";
      } else if (pr.owner !== p.id) {
        if (pr.mortgaged) {
          log(g, `${sq.name} está hipotecada: no se paga alquiler.`);
        } else {
          pay(g, p, rentFor(g, index, diceTotal, mods), pr.owner, `alquiler de ${sq.name}`);
        }
      }
      return;
    }
    case "tax":
      return pay(g, p, sq.amount, null, sq.name);
    case "card":
      return drawCard(g, p, sq.deck, diceTotal);
    case "goToJail":
      return sendToJail(g, p);
    default:
      return;
  }
}

function drawCard(g: GameState, p: Player, deck: Deck, diceTotal: number): void {
  const pile = g.decks[deck];
  const index = pile.shift() ?? fail("No quedan tarjetas.");
  const card = CARDS[deck][index];
  if (!card) fail("No quedan tarjetas.");
  if (card.effect.type !== "jailCard") pile.push(index);
  g.card = { id: g.nextId++, deck, text: card.text, playerId: p.id };
  log(g, `${p.name} sacó ${deck === "suerte" ? "Suerte" : "Caja Municipal"}: “${card.text}”`);

  const e = card.effect;
  switch (e.type) {
    case "money":
      if (e.amount >= 0) p.cash += e.amount;
      else pay(g, p, -e.amount, null);
      return;
    case "moveTo":
      walkTo(g, p, e.square);
      return land(g, p, diceTotal);
    case "moveBy":
      walk(g, p, e.steps);
      return land(g, p, diceTotal);
    case "nearestStation":
      walkTo(g, p, nextOfKind(p.position, "station"));
      return land(g, p, diceTotal, { stationMultiplier: 2 });
    case "nearestUtility":
      walkTo(g, p, nextOfKind(p.position, "utility"));
      return land(g, p, diceTotal, { utilityTimes10: true });
    case "jail":
      return sendToJail(g, p);
    case "jailCard":
      p.jailCards.push(deck);
      return;
    case "repairs": {
      let cost = 0;
      for (const i of ownedBy(g, p.id)) {
        const houses = g.props[i]?.houses ?? 0;
        cost += houses === HOTEL ? e.hotel : houses * e.house;
      }
      if (cost > 0) pay(g, p, cost, null, "reparaciones");
      return;
    }
    case "eachPlayer":
      for (const other of activePlayers(g)) {
        if (other.id === p.id) continue;
        if (e.amount > 0) pay(g, other, e.amount, p.id);
        else pay(g, p, -e.amount, other.id);
      }
      return;
  }
}

function nextOfKind(from: number, kind: "station" | "utility"): number {
  const options = squaresOfKind(kind);
  return options.find((i) => i > from) ?? options[0] ?? from;
}

function returnJailCard(g: GameState, deck: Deck): void {
  const index = CARDS[deck].findIndex((c) => c.effect.type === "jailCard");
  if (index !== -1 && !g.decks[deck].includes(index)) g.decks[deck].push(index);
}

/**
 * Charges in full even past zero. A negative balance blocks the game until the debtor
 * raises the money (selling, mortgaging, trading) or goes bankrupt. The payee is credited at
 * once; whatever the payer could not cover is remembered as a debt, and goes back to the bank
 * if the payer ends up bankrupt.
 */
function pay(g: GameState, payer: Player, amount: number, toId: string | null, reason?: string): void {
  if (amount <= 0) return;
  const to = toId ? findPlayer(g, toId) : undefined;
  charge(payer, amount, to?.id ?? null);
  if (to) to.cash += amount;
  log(g, `${payer.name} pagó ${money(amount)} a ${to?.name ?? "el banco"}${reason ? ` (${reason})` : ""}.`);
  if (payer.cash < 0) log(g, `${payer.name} debe ${money(-payer.cash)}: vende, hipoteca o declárate en quiebra.`);
}

/** Takes `amount` from `p`, noting the part their cash could not cover as owed to `toId`. */
function charge(p: Player, amount: number, toId: string | null): void {
  p.debts = debtsOf(p);
  const unpaid = amount - Math.min(amount, Math.max(0, p.cash));
  p.cash -= amount;
  if (unpaid > 0) p.debts.push({ to: toId, amount: unpaid });
}

/** `toBank` gives everything up to the bank instead of to the creditor owed the most. */
function goBankrupt(g: GameState, p: Player, toBank = false): void {
  const owed = debtsOf(p);
  const creditor = toBank ? undefined : findPlayer(g, mainCreditor(p));
  const heir = creditor && !creditor.bankrupt && creditor.id !== p.id ? creditor : null;
  // Creditors were paid in full up front; the part the debtor never had goes back.
  let clawedBack = 0;
  for (const d of owed) {
    const c = findPlayer(g, d.to);
    if (!c || c.bankrupt || c.id === p.id) continue;
    charge(c, d.amount, null);
    clawedBack += d.amount;
    if (c.cash < 0) log(g, `${c.name} debe ${money(-c.cash)}: vende, hipoteca o declárate en quiebra.`);
  }
  for (const other of g.players) {
    for (const d of other.debts) if (d.to === p.id) d.to = heir?.id ?? null;
  }
  for (const i of ownedBy(g, p.id)) {
    const pr = prop(g, i);
    const sq = square(i);
    if (pr.houses > 0 && sq.kind === "street") {
      const count = pr.houses === HOTEL ? 5 : pr.houses;
      if (heir) heir.cash += (count * sq.houseCost) / 2;
      pr.houses = 0;
    }
    pr.owner = heir?.id ?? null;
    if (!heir) pr.mortgaged = false;
  }
  if (heir) {
    if (p.cash > 0) heir.cash += p.cash;
    heir.jailCards.push(...p.jailCards);
  } else {
    for (const deck of p.jailCards) returnJailCard(g, deck);
  }
  if (clawedBack > 0) log(g, `${money(clawedBack)} que ${p.name} no pudo pagar vuelven al banco.`);
  p.jailCards = [];
  p.cash = 0;
  p.debts = [];
  p.bankrupt = true;
  p.inJail = false;
  g.trades = g.trades.filter((t) => t.from !== p.id && t.to !== p.id);
  log(g, `${p.name} quebró${heir ? `; sus propiedades pasan a ${heir.name}` : ""}.`);

  const left = activePlayers(g);
  if (left.length === 1 && left[0]) {
    g.phase = "ended";
    g.winnerId = left[0].id;
    g.turn = null;
    log(g, `¡${left[0].name} ganó Cholopolis!`);
  } else if (g.turn?.playerId === p.id) {
    advanceTurn(g);
  }
}

// ---------------------------------------------------------------- timeouts

/** Plays the obvious move for whoever is holding up the game: roll, decline, end turn, or settle debts. */
export function autoPlay(g: GameState, rng: Rng): void {
  g.moves = [];
  if (g.phase !== "playing") return;
  const owing = debtors(g);
  if (owing.length > 0) {
    for (const d of owing) {
      raiseCash(g, d);
      if (d.cash < 0) goBankrupt(g, d);
    }
    return;
  }
  const t = g.turn;
  const p = findPlayer(g, t?.playerId);
  if (!t || !p) return;
  log(g, `Se acabó el tiempo de ${p.name}.`);
  let idleTurns = p.idleTurns;
  if (isAway(p) && !t.timedOut) {
    t.timedOut = true;
    idleTurns++;
  }
  if (idleTurns >= ABANDON_AFTER_TURNS) {
    log(g, `${p.name} sigue desconectado y abandona la partida.`);
    return goBankrupt(g, p, true);
  }
  const action: Action =
    t.stage === "roll" ? { type: "roll" } : t.stage === "buy" ? { type: "decline" } : { type: "endTurn" };
  act(g, p.id, action, rng);
  p.idleTurns = idleTurns;
}

/** Whether the table is playing for them because nobody is at their seat. */
function isAway(p: Player): boolean {
  return !p.connected;
}

/** Sells buildings, then mortgages, until the debt is covered or nothing is left. */
function raiseCash(g: GameState, p: Player): void {
  while (p.cash < 0) {
    const owned = ownedBy(g, p.id);
    const sellable = owned.find((i) => sellError(g, p.id, i) === null);
    if (sellable !== undefined) {
      sell(g, p, sellable);
      continue;
    }
    const mortgageable = owned.find((i) => mortgageError(g, p.id, i) === null);
    if (mortgageable === undefined) return;
    mortgage(g, p, mortgageable);
  }
}

// ---------------------------------------------------------------- utilities

function log(g: GameState, text: string): void {
  g.log.push({ id: g.nextId++, text });
  if (g.log.length > LOG_LIMIT) g.log.splice(0, g.log.length - LOG_LIMIT);
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
