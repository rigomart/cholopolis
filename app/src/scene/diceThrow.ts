import * as THREE from "three";

import { DICE_FLOOR, type DicePose, DICE_WALL, type DiceToss, parseDiceToss } from "../../../shared/dice.ts";
import { DIE, FACE_NORMALS } from "./dice.ts";
import { type Body, DiceWorld, type Plane, rotate, STEP, type Surface, vec } from "./dicePhysics.ts";

/** Frames are kept for every other physics step: 120 per second. */
const FRAME_STEPS = 2;
export const FRAME_TIME = STEP * FRAME_STEPS;
const MAX_STEPS = Math.round(8 / STEP);
const QUIET_STEPS = Math.round(0.25 / STEP);
const ATTEMPTS = 12;
/**
 * Steps all attempts may spend between them; past it the best attempt so far stands. Counted in
 * steps, not time, so every client stops at the same attempt.
 */
const STEP_BUDGET = Math.round(10 / STEP);
/** Landing on the logo is only worth this many retries; a cocked or stacked die always is. */
const LOGO_ATTEMPTS = 2;
const COCKED = 10;

export interface DiceThrow {
  /** Per frame, 14 numbers: position (x, y, z) and rotation (x, y, z, w) of each die. */
  frames: Float64Array;
  frameCount: number;
  duration: number;
  impacts: { at: number; strength: number; surface: Surface }[];
  /** The die-local axis that faces up once each die has settled. */
  up: [THREE.Vector3, THREE.Vector3];
}

export const BOARD_PLANES: Plane[] = [
  { normal: vec(0, 1, 0), offset: DICE_FLOOR, velocity: vec(), surface: "board" },
  { normal: vec(1, 0, 0), offset: -DICE_WALL, velocity: vec(), surface: "wall" },
  { normal: vec(-1, 0, 0), offset: -DICE_WALL, velocity: vec(), surface: "wall" },
  { normal: vec(0, 0, 1), offset: -DICE_WALL, velocity: vec(), surface: "wall" },
  { normal: vec(0, 0, -1), offset: -DICE_WALL, velocity: vec(), surface: "wall" },
];

/**
 * Plays a toss out to rest. A throw that ends with a die cocked, stacked or lying on the logo
 * is thrown again with a small deterministic nudge, so every client picks the same one.
 */
export function simulateToss(toss: DiceToss): DiceThrow {
  let best: { flight: DiceThrow; score: number } | null = null;
  let spent = 0;
  for (let attempt = 0; attempt < ATTEMPTS && spent < STEP_BUDGET; attempt++) {
    const flight = run(nudge(toss, attempt));
    spent += (flight.frameCount - 1) * FRAME_STEPS;
    const score = judge(flight);
    if (score === 0 || (score < COCKED && attempt >= LOGO_ATTEMPTS)) return flight;
    if (!best || score < best.score) best = { flight, score };
  }
  return best!.flight;
}

function nudge(toss: DiceToss, attempt: number): DiceToss {
  if (attempt === 0) return toss;
  const sign = attempt % 2 ? 1 : -1;
  const slower = 1 - 0.04 * attempt;
  return {
    dice: toss.dice.map((die, n) => ({
      ...die,
      velocity: { x: die.velocity.x * slower, y: die.velocity.y, z: die.velocity.z * slower },
      spin: {
        x: die.spin.x + sign * 1.3 * attempt,
        y: die.spin.y + (n ? -0.8 : 0.8) * attempt,
        z: die.spin.z - sign * 0.9 * attempt,
      },
    })) as DiceToss["dice"],
  };
}

function run(toss: DiceToss): DiceThrow {
  const bodies = toss.dice.map((d): Body => ({
    p: { ...d.position },
    q: { ...d.rotation },
    v: { ...d.velocity },
    w: { ...d.spin },
  })) as [Body, Body];
  const world = new DiceWorld(bodies, BOARD_PLANES);
  const frames: number[] = [];
  const record = () => {
    for (const b of bodies) frames.push(b.p.x, b.p.y, b.p.z, b.q.x, b.q.y, b.q.z, b.q.w);
  };
  const impacts: DiceThrow["impacts"] = [];
  const lastHit: (DiceThrow["impacts"][number] | undefined)[] = [];
  let quiet = 0;
  let step = 0;
  record();
  while (step < MAX_STEPS && quiet < QUIET_STEPS) {
    const hits = world.step();
    step++;
    const at = step * STEP;
    for (const hit of hits) {
      const strength = Math.min(1, hit.impulse / 16);
      if (strength < 0.04) continue;
      const previous = lastHit[hit.die];
      if (previous && at - previous.at < 0.06) {
        previous.strength = Math.max(previous.strength, strength);
        continue;
      }
      const impact = { at, strength, surface: hit.surface };
      impacts.push(impact);
      lastHit[hit.die] = impact;
    }
    quiet = world.quiet() ? quiet + 1 : 0;
    if (step % FRAME_STEPS === 0) record();
  }
  if (step % FRAME_STEPS !== 0) record();
  const frameCount = frames.length / 14;
  return {
    frames: Float64Array.from(frames),
    frameCount,
    duration: (frameCount - 1) * FRAME_TIME,
    impacts,
    up: [upAxis(bodies[0]), upAxis(bodies[1])],
  };
}

/** The die-local axis closest to world up. */
function upAxis(body: Body): THREE.Vector3 {
  let best = new THREE.Vector3();
  let most = -Infinity;
  for (const normal of Object.values(FACE_NORMALS)) {
    const facing = rotate(body.q, normal).y;
    if (facing > most) {
      most = facing;
      best = normal.clone();
    }
  }
  return best;
}

/** 0 for a clean finish; higher is worse. */
function judge(flight: DiceThrow): number {
  let score = 0;
  for (let n = 0; n < 2; n++) {
    const pose = framePose(flight, flight.frameCount - 1, n);
    const facing = rotate(pose.rotation, flight.up[n]!).y;
    if (facing < 0.995 || pose.position.y > DICE_FLOOR + DIE / 2 + 0.02) score += COCKED;
    if (onLogo(pose.position)) score += 1;
  }
  return score;
}

/** The CHOLOPOLIS lettering, which runs diagonally across the centre. */
function onLogo(p: { x: number; z: number }): boolean {
  const along = (p.x - p.z) * Math.SQRT1_2;
  const across = (p.x + p.z) * Math.SQRT1_2;
  return Math.abs(along) < 3.9 && Math.abs(across) < 0.85;
}

export function framePose(flight: DiceThrow, frame: number, die: number) {
  const i = (Math.max(0, Math.min(flight.frameCount - 1, frame)) * 2 + die) * 7;
  const f = flight.frames;
  return {
    position: { x: f[i]!, y: f[i + 1]!, z: f[i + 2]! },
    rotation: { x: f[i + 3]!, y: f[i + 4]!, z: f[i + 5]!, w: f[i + 6]! },
  };
}

/**
 * The turn to apply inside a die so that `value` sits on `up`. It is one of the cube's own
 * symmetries, so the die looks the same; only which pips face where changes.
 */
export function faceTurn(value: number, up: THREE.Vector3): THREE.Quaternion {
  const from = FACE_NORMALS[value] ?? FACE_NORMALS[1]!;
  return new THREE.Quaternion().setFromUnitVectors(from, up);
}

/** Integer hash so button rolls differ from one another but replay the same everywhere. */
function random(seed: number): () => number {
  let s = (Math.imul(seed + 1, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRotation(r: () => number) {
  const q = { x: r() - 0.5, y: r() - 0.5, z: r() - 0.5, w: r() - 0.5 };
  const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return n < 0.1 ? { x: 0, y: 0, z: 0, w: 1 } : { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/**
 * A throw for the roll button: the dice are scooped up where they lie and tossed toward the open
 * board beside the logo. Without `from` (rolls the server makes for bots and the turn clock) they
 * leave from the near side instead.
 */
export function automaticToss(rollId: number, from?: DicePose[]): DiceToss {
  const r = random(rollId);
  const spread = (size: number) => (r() - 0.5) * size;
  const near = spread(4);
  const start = from?.map((pose) => pose.position) ?? [-1, 1].map((side) => ({ x: near + side * 0.4, z: 3.3 }));
  const centre = { x: (start[0]!.x + start[1]!.x) / 2, z: (start[0]!.z + start[1]!.z) / 2 };
  // Aim along the logo's side the dice are on, a few steps from where they lie.
  const along = Math.max(-2.5, Math.min(2.5, (centre.x - centre.z) * Math.SQRT1_2 + spread(3)));
  const across = centre.x + centre.z < 0 ? -1.5 : 1.5;
  const target = { x: (along + across) * Math.SQRT1_2, z: (across - along) * Math.SQRT1_2 };
  let aim = { x: target.x - centre.x, z: target.z - centre.z };
  let distance = Math.sqrt(aim.x * aim.x + aim.z * aim.z);
  if (distance < 1.5) {
    aim = { x: -aim.z, z: aim.x };
    distance = 1.5;
  }
  const speed = Math.min(10, 2.5 + distance * 1.4) * (0.8 + r() * 0.4);
  const drift = spread(0.5) * speed;
  const unit = Math.sqrt(aim.x * aim.x + aim.z * aim.z) || 1;
  const forward = { x: aim.x / unit, z: aim.z / unit };
  const velocity = { x: forward.x * speed - forward.z * drift, z: forward.z * speed + forward.x * drift };
  const dice = start.map((p) => ({
    position: { x: p.x, y: DICE_FLOOR + 1.2 + r() * 0.3, z: p.z },
    rotation: randomRotation(r),
    velocity: { x: velocity.x + spread(1), y: 2 + r(), z: velocity.z + spread(1) },
    spin: { x: spread(28), y: spread(14), z: spread(28) },
  }));
  return parseDiceToss({ dice })!;
}
