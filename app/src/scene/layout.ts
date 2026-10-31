/**
 * Board geometry in board units. The board is 13 units across: two 2-unit corners and nine
 * 1-unit squares per side, centred on the origin. "Local" coordinates describe a square as if it
 * sat on the bottom side (Salida's row, nearest the camera); each side is that row turned 90°.
 * Local x runs right, local z runs toward the viewer; the outer edge is z = 6.5.
 */
export const BOARD_SIZE = 13;
export const HALF = BOARD_SIZE / 2;
export const INNER = HALF - 2;
export const BAND = 0.46;

export interface Local {
  x: number;
  z: number;
}

export const sideOf = (index: number) => Math.floor(index / 10);
export const isCorner = (index: number) => index % 10 === 0;

/** Rotates a local point onto side `side` (0 bottom, 1 left, 2 top, 3 right). */
export function toBoard(p: Local, side: number): Local {
  let { x, z } = p;
  for (let i = 0; i < ((side % 4) + 4) % 4; i++) [x, z] = [-z, x];
  return { x, z };
}

function fromBoard(p: Local, side: number): Local {
  let { x, z } = p;
  for (let i = 0; i < side; i++) [x, z] = [z, -x];
  return { x, z };
}

/** Centre of a square in local coordinates. */
export function localCenter(index: number): Local {
  const k = index % 10;
  return k === 0 ? { x: INNER + 1, z: INNER + 1 } : { x: 5 - k, z: INNER + 1 };
}

export function squareCenter(index: number): Local {
  return toBoard(localCenter(index), sideOf(index));
}

/** Where pieces stand on a square: the half away from the color band, spread out when several share it. */
export function pieceSpot(index: number, slot: number, count: number): Local {
  const c = localCenter(index);
  const cols = count <= 2 ? count : count <= 4 ? 2 : 3;
  const col = slot % cols;
  const row = Math.floor(slot / cols);
  const rows = Math.ceil(count / cols);
  const spacing = isCorner(index) ? 0.5 : 0.3;
  const x = c.x + (col - (cols - 1) / 2) * spacing;
  const z = c.z + 0.25 + (row - (rows - 1) / 2) * spacing;
  return toBoard({ x, z }, sideOf(index));
}

/** Spot for the n-th house (0–3), or the hotel when n is 4, on the color band. */
export function buildingSpot(index: number, n: number): Local {
  const c = localCenter(index);
  const x = n === 4 ? c.x : c.x + (n - 1.5) * 0.23;
  return toBoard({ x, z: INNER + BAND / 2 }, sideOf(index));
}

/** The square under a point on the board, or null for the centre. */
export function squareAt(p: Local): number | null {
  if (Math.abs(p.x) > HALF || Math.abs(p.z) > HALF) return null;
  if (Math.abs(p.x) < INNER && Math.abs(p.z) < INNER) return null;
  for (let side = 0; side < 4; side++) {
    const l = fromBoard(p, side);
    if (l.z < INNER || l.x < -INNER) continue;
    if (l.x >= INNER) return side * 10;
    return side * 10 + Math.min(9, Math.max(1, Math.round(5 - l.x)));
  }
  return null;
}

/** A square's footprint on the board: its centre, and its size along x and z. */
export function squareBounds(index: number): Local & { width: number; depth: number } {
  const c = squareCenter(index);
  if (isCorner(index)) return { ...c, width: 2, depth: 2 };
  const across = sideOf(index) % 2 === 0;
  return { ...c, width: across ? 1 : 2, depth: across ? 2 : 1 };
}
