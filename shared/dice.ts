/**
 * Cosmetic dice data sent by the thrower: the live hold (`DiceHold`) and the release state of
 * both dice (`DiceToss`). Values never come from here; the server rolls them. Parsing clamps
 * everything to the dice arena and snaps numbers to a 1e-4 grid, and parsing twice gives the
 * same result, so the thrower can replay exactly what the server stores.
 */
export interface DiceVector {
  x: number;
  y: number;
  z: number;
}

export interface DiceQuaternion extends DiceVector {
  w: number;
}

export interface DicePose {
  position: DiceVector;
  rotation: DiceQuaternion;
}

export interface DieRelease extends DicePose {
  velocity: DiceVector;
  spin: DiceVector;
}

export interface DiceHold {
  dice: [DicePose, DicePose];
  /** How hard the dice are rattling in the hand, 0 to 1. */
  shake: number;
}

export interface DiceToss {
  dice: [DieRelease, DieRelease];
}

/** Top of the board, where dice rest. */
export const DICE_FLOOR = 0.35;
/** Walls stand this far from the centre on x and z: the edge of the inner square. */
export const DICE_WALL = 4.5;
export const DICE_CEILING = DICE_FLOOR + 4;
/** Dice released closer than this, centre to centre, are moved apart. */
export const DICE_GAP = 0.7;
export const DICE_SPEED_LIMIT = 20;
export const DICE_SPIN_LIMIT = 40;
export const DICE_HOLD_INTERVAL_MS = 80;
export const DICE_HOLD_EXPIRE_MS = 1500;
export const DICE_HOLD_MAX_MS = 15_000;

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Snaps to a 1e-4 grid; `+ 0` turns -0 into 0 so JSON round trips are exact. */
const snap = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const within = (v: number, min: number, max: number) => snap(Math.max(min, Math.min(max, v)));

/** A vector capped in length, keeping its direction. */
function vector(v: unknown, limit: number): DiceVector | null {
  if (!object(v) || !finite(v.x) || !finite(v.y) || !finite(v.z)) return null;
  // Bound each part first so squaring can't overflow.
  const x = within(v.x, -1e6, 1e6);
  const y = within(v.y, -1e6, 1e6);
  const z = within(v.z, -1e6, 1e6);
  const length = Math.sqrt(x * x + y * y + z * z);
  // The tolerance keeps a second pass from rescaling a vector that was already capped.
  if (length <= limit + 0.01) return { x, y, z };
  const scale = limit / length;
  return { x: snap(x * scale), y: snap(y * scale), z: snap(z * scale) };
}

const EDGE = DICE_WALL - 0.3;

function position(v: unknown): DiceVector | null {
  if (!object(v) || !finite(v.x) || !finite(v.y) || !finite(v.z)) return null;
  return { x: within(v.x, -EDGE, EDGE), y: within(v.y, DICE_FLOOR + 0.3, DICE_CEILING), z: within(v.z, -EDGE, EDGE) };
}

function rotation(v: unknown): DiceQuaternion | null {
  if (!object(v) || !finite(v.x) || !finite(v.y) || !finite(v.z) || !finite(v.w)) return null;
  const q = { x: within(v.x, -1, 1), y: within(v.y, -1, 1), z: within(v.z, -1, 1), w: within(v.w, -1, 1) };
  const norm = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (norm < 0.25) return null;
  if (Math.abs(norm - 1) < 1e-3) return q;
  const scale = 1 / Math.sqrt(norm);
  return { x: snap(q.x * scale), y: snap(q.y * scale), z: snap(q.z * scale), w: snap(q.w * scale) };
}

function pose(v: unknown): DicePose | null {
  if (!object(v)) return null;
  const p = position(v.position);
  const q = rotation(v.rotation);
  return p && q ? { position: p, rotation: q } : null;
}

function release(v: unknown): DieRelease | null {
  const base = pose(v);
  if (!base || !object(v)) return null;
  const velocity = vector(v.velocity, DICE_SPEED_LIMIT);
  const spin = vector(v.spin, DICE_SPIN_LIMIT);
  return velocity && spin ? { ...base, velocity, spin } : null;
}

function pair<T>(v: unknown, parse: (v: unknown) => T | null): [T, T] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = parse(v[0]);
  const b = parse(v[1]);
  return a && b ? [a, b] : null;
}

export function parseDiceHold(v: unknown): DiceHold | null {
  if (!object(v) || !finite(v.shake)) return null;
  const dice = pair(v.dice, pose);
  return dice ? { dice, shake: within(v.shake, 0, 1) } : null;
}

/**
 * Overlapping dice would spend the whole replay fighting free, on every screen, so they are
 * spread sideways about their midpoint, kept inside the arena.
 */
function apart([a, b]: [DieRelease, DieRelease]): [DieRelease, DieRelease] {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const dy = b.position.y - a.position.y;
  // The tolerance keeps a second pass from moving dice the first one already spread.
  if (dx * dx + dy * dy + dz * dz >= (DICE_GAP - 0.01) ** 2) return [a, b];
  const flat = Math.sqrt(dx * dx + dz * dz);
  const ux = flat > 1e-3 ? dx / flat : 1;
  const uz = flat > 1e-3 ? dz / flat : 0;
  const hx = (ux * DICE_GAP) / 2;
  const hz = (uz * DICE_GAP) / 2;
  const mx = within((a.position.x + b.position.x) / 2, -EDGE + Math.abs(hx), EDGE - Math.abs(hx));
  const mz = within((a.position.z + b.position.z) / 2, -EDGE + Math.abs(hz), EDGE - Math.abs(hz));
  return [
    { ...a, position: { ...a.position, x: snap(mx - hx), z: snap(mz - hz) } },
    { ...b, position: { ...b.position, x: snap(mx + hx), z: snap(mz + hz) } },
  ];
}

export function parseDiceToss(v: unknown): DiceToss | null {
  if (!object(v)) return null;
  const dice = pair(v.dice, release);
  return dice ? { dice: apart(dice) } : null;
}
