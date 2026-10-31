import { HALF, type Local, sideOf, toBoard } from "./layout.ts";

/** The orbit point on the board (`target`), distance, tilt from straight down (`phi`) and turn (`theta`, 0 from Salida's side), as in three's Spherical. */
export interface View {
  target: Local;
  radius: number;
  phi: number;
  theta: number;
}

export type ViewName = "tablero" | "arriba" | "ficha";

const QUARTER = Math.PI / 2;
export const FOV = 38;
const TAN_HALF_FOV = Math.tan((FOV * Math.PI) / 360);

/** How far from the centre, along either axis, the orbit point may go: panning and zooming never lose the board. */
export const TARGET_LIMIT = HALF - 0.5;
export const MIN_DISTANCE = 4;
const HOME_PHI = Math.atan2(13.5, 15.5);
export const HOME_DISTANCE = 21;
const HOME_DOCK_CLEARANCE = 1.7;
/** Not 0: the dice throw direction is the camera's flattened view direction. */
const TOP_PHI = 0.05;
const PAWN_PHI = 0.78;
const PAWN_DISTANCE = 11;

/** Angle `a` brought into (-π, π]. */
export function wrapAngle(a: number): number {
  const w = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return w === 0 ? Math.PI : w - Math.PI;
}

/** The signed turn from `from` to `to` the short way round. */
export const angleDelta = (from: number, to: number) => wrapAngle(to - from);

/** The camera turn that reads board side `side` (0 Salida's row, then clockwise) the right way up. */
export function sideTheta(side: number): number {
  const out = toBoard({ x: 0, z: 1 }, side);
  return wrapAngle(Math.atan2(out.x, out.z));
}

/** The nearest turn that faces a board side square on, so the street names read straight. */
export const snapTheta = (theta: number) => wrapAngle(Math.round(theta / QUARTER) * QUARTER);

/** One side over: `dir` 1 turns the board clockwise on screen, -1 the other way. */
export const rotateTheta = (theta: number, dir: 1 | -1) => wrapAngle(snapTheta(theta) + dir * QUARTER);

const clampToLimit = (v: number) => Math.max(-TARGET_LIMIT, Math.min(TARGET_LIMIT, v));

/** Keeps the orbit point over the board. */
export const clampTarget = (p: Local): Local => ({ x: clampToLimit(p.x), z: clampToLimit(p.z) });

const towardViewer = (p: Local, theta: number, by: number): Local => ({
  x: p.x + Math.sin(theta) * by,
  z: p.z + Math.cos(theta) * by,
});

const backOffToFitWidth = (aspect: number, widthFit: number) => Math.max(1, widthFit / aspect);

export function homeView(aspect: number, theta = 0): View {
  return {
    target: towardViewer({ x: 0, z: 0 }, theta, HOME_DOCK_CLEARANCE),
    radius: HOME_DISTANCE * backOffToFitWidth(aspect, 1.1),
    phi: HOME_PHI,
    theta,
  };
}

/** Straight down, the whole board in frame with room for the panels above and below. */
export function topView(aspect: number, theta = 0): View {
  const shift = 0.6;
  const tall = HALF + shift + 1.6;
  const wide = HALF + 0.3;
  return {
    target: towardViewer({ x: 0, z: 0 }, theta, shift),
    radius: Math.max(tall / TAN_HALF_FOV, wide / (TAN_HALF_FOV * aspect)),
    phi: TOP_PHI,
    theta,
  };
}

/** Close on a spot of the board, from outside its side so its row reads the right way up. */
export function spotView(aspect: number, spot: Local, square: number): View {
  const theta = sideTheta(sideOf(square));
  return {
    target: clampTarget(towardViewer(spot, theta, 0.6)),
    radius: PAWN_DISTANCE * backOffToFitWidth(aspect, 0.9),
    phi: PAWN_PHI,
    theta,
  };
}

/** The farthest the camera may back off: past the farthest view, so none gets clamped. */
export function maxDistance(aspect: number): number {
  return Math.max(34, homeView(aspect).radius * 1.25, topView(aspect).radius * 1.1);
}

/** `t` of the way from `a` to `b`, turning the short way. */
export function lerpView(a: View, b: View, t: number): View {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    target: { x: lerp(a.target.x, b.target.x), z: lerp(a.target.z, b.target.z) },
    radius: lerp(a.radius, b.radius),
    phi: lerp(a.phi, b.phi),
    theta: wrapAngle(a.theta + angleDelta(a.theta, b.theta) * t),
  };
}

// ---------------------------------------------------------------- following the play

const FOLLOW_KEY = "cholopolis:seguir-jugada";

/** Phones (narrow or upright screens) follow the play unless told otherwise; desktops don't. */
export const followByDefault = (width: number, height: number) => width < 700 || height > width;

export function loadFollow(storage: Pick<Storage, "getItem"> | undefined, width: number, height: number): boolean {
  const saved = storage?.getItem(FOLLOW_KEY);
  return saved === "1" ? true : saved === "0" ? false : followByDefault(width, height);
}

export function saveFollow(storage: Pick<Storage, "setItem"> | undefined, on: boolean): void {
  storage?.setItem(FOLLOW_KEY, on ? "1" : "0");
}

export interface FollowGate {
  enabled: boolean;
  reducedMotion: boolean;
  /** A finger or the mouse is on the board, turning or zooming it. */
  touching: boolean;
  diceHeld: boolean;
}

/** The camera only moves on its own when the player asked for it and isn't busy with the board. */
export const mayFollow = (g: FollowGate) => g.enabled && !g.reducedMotion && !g.touching && !g.diceHeld;

/**
 * Whether a walk goes somewhere the player can't see well: any of its squares, in normalized
 * screen coordinates (-1 to 1 across, as three's `project` gives), outside the middle of the
 * screen or behind the camera.
 */
export function walkLeavesView(points: { x: number; y: number; z: number }[], margin = 0.8): boolean {
  return points.some((p) => p.z > 1 || Math.abs(p.x) > margin || Math.abs(p.y) > margin);
}
