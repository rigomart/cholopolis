export interface DicePoint {
  x: number;
  z: number;
}

export interface DiceVector extends DicePoint {
  y: number;
}

export interface DiceDrag {
  point: DicePoint;
  rotation: DiceVector;
  intensity: number;
}

export interface DiceToss {
  point: DicePoint;
  velocity: DicePoint;
  spin: DiceVector;
  rotation: DiceVector;
}

export const DICE_DRAG_INTERVAL_MS = 80;
export const DICE_DRAG_EXPIRE_MS = 1500;
export const DICE_HOLD_MAX_MS = 15_000;
export const DICE_GRAB_LIMIT = 5;
export const DICE_SPEED_LIMIT = 12;

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

function point(v: unknown): DicePoint | null {
  if (!object(v) || !finite(v.x) || !finite(v.z)) return null;
  return { x: clamp(v.x, DICE_GRAB_LIMIT), z: clamp(v.z, DICE_GRAB_LIMIT) };
}

function vector(v: unknown, limit: number): DiceVector | null {
  if (!object(v) || !finite(v.x) || !finite(v.y) || !finite(v.z)) return null;
  return { x: clamp(v.x, limit), y: clamp(v.y, limit), z: clamp(v.z, limit) };
}

export function parseDiceDrag(v: unknown): DiceDrag | null {
  if (!object(v) || !finite(v.intensity)) return null;
  const p = point(v.point);
  const rotation = vector(v.rotation, Math.PI);
  return p && rotation ? { point: p, rotation, intensity: Math.max(0, Math.min(1, v.intensity)) } : null;
}

export function parseDiceToss(v: unknown): DiceToss | null {
  if (!object(v) || !object(v.velocity) || !finite(v.velocity.x) || !finite(v.velocity.z)) return null;
  const p = point(v.point);
  const rotation = vector(v.rotation, Math.PI);
  const spin = vector(v.spin, 30);
  if (!p || !rotation || !spin) return null;
  const speed = Math.hypot(v.velocity.x, v.velocity.z);
  const scale = speed > DICE_SPEED_LIMIT ? DICE_SPEED_LIMIT / speed : 1;
  const spinScale = Math.min(1, 30 / Math.hypot(spin.x, spin.y, spin.z));
  return {
    point: p,
    velocity: { x: v.velocity.x * scale, z: v.velocity.z * scale },
    spin: { x: spin.x * spinScale, y: spin.y * spinScale, z: spin.z * spinScale },
    rotation,
  };
}
