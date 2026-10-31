import { square } from "./board.ts";
import { money, type PublicState } from "./game.ts";
import type { PlayerStats } from "./stats.ts";

/** One line of the postcard: the player's name goes first, then `text`. */
export interface Highlight {
  playerId: string;
  text: string;
}

interface Candidate extends Highlight {
  kind: string;
  score: number;
}

/** `par`: the value worth telling, which scores 1. */
const KINDS: { kind: string; par: number; read: (s: PlayerStats) => [value: number, text: string] | null }[] = [
  {
    kind: "knockouts",
    par: 0.7,
    read: (s) => [s.knockouts, `mandó a ${count(s.knockouts, "rival", "rivales")} a la quiebra`],
  },
  {
    kind: "rentPaidAt",
    par: 500,
    read: (s) => top(s.rentPaidAt, (i, n) => `pagó ${money(n)} de alquiler en ${place(i)}`),
  },
  {
    kind: "rentReceivedAt",
    par: 700,
    read: (s) => top(s.rentReceivedAt, (i, n) => `cobró ${money(n)} de alquiler en ${place(i)}`),
  },
  { kind: "jailed", par: 2, read: (s) => [s.jailed, `fue al Penal ${times(s.jailed)}`] },
  {
    kind: "biggestPayment",
    par: 600,
    read: (s) => [s.biggestPayment, `soltó ${money(s.biggestPayment)} de un solo golpe`],
  },
  { kind: "paidToBank", par: 600, read: (s) => [s.paidToBank, `le regaló ${money(s.paidToBank)} al banco`] },
  { kind: "laps", par: 8, read: (s) => [s.laps, `dio ${count(s.laps, "vuelta", "vueltas")} al tablero`] },
  { kind: "doubles", par: 6, read: (s) => [s.doubles, `sacó dobles ${times(s.doubles)}`] },
  {
    kind: "purchases",
    par: 6,
    read: (s) => [s.purchases, `se compró ${count(s.purchases, "propiedad", "propiedades")}`],
  },
  { kind: "built", par: 8, read: (s) => [s.built, `levantó ${count(s.built, "edificio", "edificios")}`] },
];

const MAX_PER_PLAYER = 2;

/**
 * The game's most notable stats, at most one of each kind and two per player, the most
 * remarkable first (each stat measured against what is usual for it).
 */
export function highlights(g: PublicState, limit = 3): Highlight[] {
  const candidates: Candidate[] = [];
  for (const p of g.players) {
    const stats = g.stats[p.id];
    if (!stats) continue;
    for (const { kind, par, read } of KINDS) {
      const found = read(stats);
      if (found && found[0] > 0) candidates.push({ playerId: p.id, kind, text: found[1], score: found[0] / par });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked: Candidate[] = [];
  for (const c of candidates) {
    if (picked.length === limit) break;
    if (picked.some((x) => x.kind === c.kind)) continue;
    if (picked.filter((x) => x.playerId === c.playerId).length === MAX_PER_PLAYER) continue;
    picked.push(c);
  }
  return picked.map(({ playerId, text }) => ({ playerId, text }));
}

function top(bySquare: Record<number, number>, text: (square: number, amount: number) => string) {
  let best: [number, number] | null = null;
  for (const [key, amount] of Object.entries(bySquare)) if (!best || amount > best[1]) best = [Number(key), amount];
  return best && ([best[1], text(...best)] as [number, string]);
}

/** A square as Limeños say it: "la Javier Prado", "el Jr. de la Unión". */
export function place(index: number): string {
  const sq = square(index);
  const name = sq.name;
  if (name.startsWith("Av. El ")) return `la ${name}`;
  if (name.startsWith("Av. ")) return `la ${name.slice(4)}`;
  if (name.startsWith("Calle ")) return `la calle ${name.slice(6)}`;
  if (name.startsWith("Línea ")) return `la ${name}`;
  if (sq.kind === "utility") return name;
  return `el ${name}`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? "una vez" : `${n} veces`);
