import * as THREE from "three";

import { easeIn, easeOut, easeOutBack as overshoot } from "./effects.ts";

export const HOUSE_MS = 1250;
export const HOTEL_MS = 2300;
export const HOTEL_FLOORS = 4;

/** A sound the build plays when its progress passes `at`. */
export type Cue = "tap" | "whir" | "thunk";
export interface CuePoint {
  at: number;
  cue: Cue;
}

/** How far a house starts below the board, to be out of sight. */
const SINK = 0.26;
const SCAFFOLD_HEIGHT = 0.21;
const HALF_W = 0.105;
const HALF_D = 0.115;
const RAIL_LEVELS = [0.07, 0.14];

const MAST_X = 0.46;
const JIB_Y = 0.6;
const HOOK_NEAR = -0.3;
const HOOK_OVER = -MAST_X;
const JIB_DROP = 0.012;
const HOOK_H = 0.03;

const span = (t: number, from: number, to: number) => THREE.MathUtils.clamp((t - from) / (to - from), 0, 1);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** `easeOutBack` that lands exactly on 0 and 1. */
const back = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : overshoot(t));

// ------------------------------------------------------------------ timelines (pure)

export interface HousePose {
  /** 0 to 1: how far the poles have grown. */
  poles: number;
  /** 0 to 1: how far the rails have slid in. */
  rails: number;
  /** 0 below the board to 1 standing, running a little past 1 as the house settles. */
  rise: number;
}

export function housePose(t: number): HousePose {
  const up = easeOut(span(t, 0, 0.22));
  const down = easeIn(span(t, 0.8, 1));
  return {
    poles: up * (1 - down),
    rails: smooth(span(t, 0.14, 0.3)) * (1 - smooth(span(t, 0.7, 0.84))),
    rise: back(span(t, 0.28, 0.68)),
  };
}

export const HOUSE_CUES: CuePoint[] = [
  { at: 0.2, cue: "tap" },
  { at: 0.34, cue: "tap" },
  { at: 0.66, cue: "tap" },
];

export interface FloorPose {
  /** Centre height of the floor. */
  y: number;
  /** Where it hangs along the jib, in item space. */
  x: number;
  /** 0 not yet there, 1 full size. */
  scale: number;
}

export interface HotelPose {
  /** 0 folded away, 1 standing and swung over the hotel. */
  crane: number;
  /** Hook position: x in item space, y of the hook block. */
  hookX: number;
  hookY: number;
  floors: FloorPose[];
  /** 0 to 1: the roof popping on. */
  roof: number;
}

const FLOORS_FROM = 0.08;
const FLOOR_SPAN = 0.17;
const ROOF_FROM = FLOORS_FROM + FLOOR_SPAN * HOTEL_FLOORS;
const FOLD_FROM = ROOF_FROM + 0.08;
const FLOOR_H = 0.2 / HOTEL_FLOORS;
const HOOK_HIGH = 0.5;
const SLING = 0.045;

/** Where the hook rides and what hangs from it, for progress `t` of the hotel build. */
export function hotelPose(t: number): HotelPose {
  let hookX = MAST_X + HOOK_NEAR;
  let hookY = HOOK_HIGH;
  const floors: FloorPose[] = [];
  for (let n = 0; n < HOTEL_FLOORS; n++) {
    const u = span(t, FLOORS_FROM + n * FLOOR_SPAN, FLOORS_FROM + (n + 1) * FLOOR_SPAN);
    const rest = n * FLOOR_H + FLOOR_H / 2;
    // Each floor: the hook swings out with it, lowers it, lets go, then lifts and swings back.
    if (u > 0 && u < 1) {
      const swing = smooth(span(u, 0, 0.3)) - smooth(span(u, 0.7, 1));
      hookX = MAST_X + HOOK_NEAR + (HOOK_OVER - HOOK_NEAR) * swing;
      const low = rest + FLOOR_H / 2 + SLING;
      hookY = HOOK_HIGH - (HOOK_HIGH - low) * (easeOut(span(u, 0.3, 0.7)) - smooth(span(u, 0.7, 0.9)));
    }
    const placed = u >= 0.7;
    floors.push({
      y: placed ? rest : hookY - SLING - FLOOR_H / 2,
      x: placed ? 0 : hookX,
      scale: u > 0 ? back(span(u, 0, 0.12)) : 0,
    });
  }
  return {
    crane: smooth(span(t, 0, 0.08)) * (1 - smooth(span(t, FOLD_FROM, 0.98))),
    hookX,
    hookY,
    floors,
    roof: back(span(t, ROOF_FROM, ROOF_FROM + 0.08)),
  };
}

export const HOTEL_CUES: CuePoint[] = [
  { at: 0.02, cue: "whir" },
  ...Array.from({ length: HOTEL_FLOORS }, (_, n) => ({
    at: FLOORS_FROM + (n + 0.7) * FLOOR_SPAN,
    cue: "thunk" as const,
  })),
  { at: ROOF_FROM + 0.03, cue: "tap" },
  { at: FOLD_FROM + 0.02, cue: "whir" },
];

/**
 * The cues that fall in `(from, to]`. A frame that arrives much later than the one before it (a tab
 * that was in the background) would play a burst of stale sounds, so those are dropped.
 */
export function cuesBetween(cues: CuePoint[], from: number, to: number): Cue[] {
  if (to - from > 0.2 || to >= 1) return [];
  return cues.filter((c) => c.at > from && c.at <= to).map((c) => c.cue);
}

// ------------------------------------------------------------------ shared pieces

function shared<T extends THREE.BufferGeometry | THREE.Material>(thing: T): T {
  thing.userData.shared = true;
  return thing;
}

function box(w: number, h: number, d: number): THREE.BoxGeometry {
  // Grows upward from its base, so scaling Y raises it from the ground.
  return shared(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0));
}

const WOOD = shared(new THREE.MeshStandardMaterial({ color: "#c79a5b", roughness: 0.9 }));
const CRANE_PAINT = shared(new THREE.MeshStandardMaterial({ color: "#f2b01e", roughness: 0.55 }));
const STEEL = shared(new THREE.MeshStandardMaterial({ color: "#4a4757", roughness: 0.6 }));

const POLE = box(0.012, SCAFFOLD_HEIGHT, 0.012);
const RAIL_X = box(HALF_W * 2, 0.012, 0.012);
const RAIL_Z = box(0.012, 0.012, HALF_D * 2);
const MAST = box(0.028, JIB_Y, 0.028);
const BASE = box(0.09, 0.03, 0.09);
const JIB = box(0.74, 0.024, 0.026);
const COUNTERWEIGHT = box(0.05, 0.05, 0.036);
const CABLE = box(0.005, 1, 0.005);
const HOOK = box(0.034, HOOK_H, 0.034);
const FLOOR_BOX = shared(new THREE.BoxGeometry(0.46, FLOOR_H, 0.16));

function part(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** The pieces of a finished building that a construction animates. */
export interface BuildingParts {
  group: THREE.Group;
  /** Body, roof and windows, so a house can rise as one. */
  core: THREE.Group;
  body: THREE.Mesh<THREE.BoxGeometry, THREE.Material>;
  roof: THREE.Mesh;
  windows: THREE.Mesh;
  /** Height of the body, where the roof sits. */
  height: number;
}

export interface Construction {
  /** Poses the building at progress `t` (0 to 1). */
  step: (t: number) => void;
  /** Takes the scaffolding or crane down; the building is left finished. */
  done: () => void;
}

/** A house rising inside a scaffold. */
export function houseConstruction(building: BuildingParts): Construction {
  const { group, core, windows } = building;
  const scaffold = new THREE.Group();
  const poles: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pole = part(POLE, WOOD, sx * HALF_W, 0, sz * HALF_D);
      poles.push(pole);
      scaffold.add(pole);
    }
  }
  const rails: THREE.Mesh[] = [];
  for (const y of RAIL_LEVELS) {
    for (const sz of [-1, 1]) rails.push(part(RAIL_X, WOOD, 0, y, sz * HALF_D));
    for (const sx of [-1, 1]) rails.push(part(RAIL_Z, WOOD, sx * HALF_W, y, 0));
  }
  scaffold.add(...rails);
  group.add(scaffold);
  windows.visible = false;

  const step = (t: number) => {
    const pose = housePose(t);
    for (const pole of poles) {
      pole.scale.y = Math.max(0.001, pose.poles);
      pole.visible = pose.poles > 0;
    }
    for (const rail of rails) {
      rail.scale.setScalar(Math.max(0.001, pose.rails));
      rail.visible = pose.rails > 0.001;
    }
    core.position.y = -SINK * (1 - pose.rise);
    core.visible = pose.rise > 0.001;
  };
  step(0);
  return {
    step,
    done: () => {
      group.remove(scaffold);
      core.position.y = 0;
      core.visible = true;
      windows.visible = true;
    },
  };
}

/** A hotel built floor by floor under a crane. */
export function hotelConstruction(building: BuildingParts): Construction {
  const { group, body, roof, windows, height } = building;
  const crane = new THREE.Group();
  crane.position.x = MAST_X;
  const mast = part(MAST, CRANE_PAINT);
  const jib = new THREE.Group();
  jib.position.y = JIB_Y - JIB_DROP;
  jib.add(part(JIB, CRANE_PAINT, -0.25, 0, 0), part(COUNTERWEIGHT, STEEL, 0.1, -0.05, 0));
  const cable = part(CABLE, STEEL);
  const hook = part(HOOK, STEEL);
  // The hook rides the jib, so it folds away with it.
  jib.add(cable, hook);
  crane.add(part(BASE, STEEL), mast, jib);

  const floors = Array.from({ length: HOTEL_FLOORS }, () => {
    const floor = part(FLOOR_BOX, body.material);
    floor.visible = false;
    return floor;
  });
  group.add(crane, ...floors);

  const roofScale = roof.scale.clone();
  const roofY = roof.position.y;
  body.visible = false;
  roof.visible = false;
  windows.visible = false;

  const step = (t: number) => {
    const pose = hotelPose(t);
    const c = Math.max(0.001, pose.crane);
    crane.visible = pose.crane > 0.001;
    mast.scale.y = c;
    jib.position.y = JIB_Y * c - JIB_DROP;
    jib.rotation.y = (1 - pose.crane) * (Math.PI / 2);
    const hookY = pose.hookY - (JIB_Y - JIB_DROP);
    hook.position.set(pose.hookX - MAST_X, hookY, 0);
    cable.position.set(pose.hookX - MAST_X, hookY + HOOK_H, 0);
    cable.scale.y = Math.max(0.001, -(hookY + HOOK_H));
    pose.floors.forEach((f, n) => {
      const floor = floors[n];
      if (!floor) return;
      floor.visible = f.scale > 0.001;
      floor.position.set(f.x, f.y, 0);
      floor.scale.setScalar(Math.max(0.001, f.scale));
    });
    roof.visible = pose.roof > 0.001;
    const r = Math.max(0.001, pose.roof);
    roof.scale.set(roofScale.x * r, roofScale.y * r, roofScale.z * r);
    roof.position.y = height + (roofY - height) * r;
  };
  step(0);
  return {
    step,
    done: () => {
      group.remove(crane, ...floors);
      body.visible = true;
      roof.visible = true;
      roof.scale.copy(roofScale);
      roof.position.y = roofY;
      windows.visible = true;
    },
  };
}
