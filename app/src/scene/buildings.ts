import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { COMBI, STREET } from "./palette.ts";

export const HOUSE = { w: 0.18, h: 0.14, d: 0.2 };
export const HOTEL_FLOORS = 4;
export const HOTEL = { w: 0.56, h: 0.3, d: 0.22 };
export const FLOOR_H = HOTEL.h / HOTEL_FLOORS;

function shared<T extends THREE.BufferGeometry | THREE.Material>(thing: T): T {
  thing.userData.shared = true;
  return thing;
}

/** Returns `geometry` translated by (x, y, z) with `color` as vertex colours; translates a non-indexed input in place. */
export function part(geometry: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.translate(x, y, z);
  const n = g.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) =>
  part(new THREE.BoxGeometry(w, h, d), color, x, y, z);

const rod = (height: number, x: number, z: number, lean = 0) =>
  part(
    new THREE.CylinderGeometry(0.0045, 0.0045, height, 5).rotateZ(lean).translate(0, height / 2, 0),
    STREET.rebar,
    x,
    0,
    z,
  );

const tank = (x: number, z: number, r = 0.03, h = 0.05) => [
  part(new THREE.CylinderGeometry(r, r, h, 10), STREET.tank, x, h / 2 + 0.014, z),
  part(new THREE.CylinderGeometry(r * 0.55, r * 0.8, 0.012, 10), STREET.tank, x, h + 0.02, z),
];

const merge = (parts: THREE.BufferGeometry[]) => shared(mergeGeometries(parts, false));

type PaneSpot = [x: number, y: number];

function panes(spots: PaneSpot[], facadeDepth: number, w: number, h: number, thickness: number, color: string) {
  return spots.map(([x, y]) => box(w, h, thickness, color, x, y, facadeDepth / 2 + thickness / 2 - 0.001));
}

const HOUSE_PANES: PaneSpot[] = [[0.04, 0.085]];
const hotelPanes = (rows: number[]): PaneSpot[] =>
  rows.flatMap((row) => [-0.2, -0.1, 0, 0.1, 0.2].map((x): PaneSpot => [x, (row + 0.5) * FLOOR_H]));

export interface BuildingGeometry {
  body: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  height: number;
}

let houseCache: BuildingGeometry | null = null;
let hotelCache: BuildingGeometry | null = null;
let floorCache: THREE.BufferGeometry | null = null;

export function houseGeometry(): BuildingGeometry {
  if (houseCache) return houseCache;
  const { w, h, d } = HOUSE;
  houseCache = {
    height: h,
    body: merge([
      box(w, h, d, STREET.concrete, 0, h / 2, 0),
      box(w + 0.006, 0.02, d + 0.006, STREET.concreteDark, 0, 0.01, 0),
      box(0.042, 0.07, 0.01, STREET.door, -0.04, 0.035 + 0.02, d / 2 + 0.004),
      ...panes(HOUSE_PANES, d, 0.05, 0.04, 0.008, STREET.glass),
    ]),
    roof: merge([
      box(w + 0.02, 0.014, d + 0.02, STREET.concreteDark, 0, 0.007, 0),
      rod(0.07, -0.075, -0.085),
      rod(0.095, 0.075, -0.085, 0.08),
      rod(0.06, -0.075, 0.085, -0.12),
      rod(0.08, 0.075, 0.085),
      ...tank(0.0, -0.02),
    ]),
    glow: merge(panes(HOUSE_PANES, d, 0.054, 0.044, 0.014, "#ffffff")),
  };
  return houseCache;
}

/** One hotel floor with its windows, which the crane hangs. */
export function floorGeometry(): THREE.BufferGeometry {
  floorCache ??= merge([
    box(HOTEL.w, FLOOR_H, HOTEL.d, COMBI.plate, 0, FLOOR_H / 2, 0),
    ...panes(
      hotelPanes([0]).map(([x]) => [x, FLOOR_H / 2] as PaneSpot),
      HOTEL.d,
      0.06,
      0.034,
      0.008,
      STREET.glass,
    ),
  ]);
  return floorCache;
}

export function hotelGeometry(): BuildingGeometry {
  if (hotelCache) return hotelCache;
  const { w, h, d } = HOTEL;
  const upper = hotelPanes([1, 2, 3]);
  const ground = hotelPanes([0]).filter(([x]) => x !== 0);
  const sign = [
    box(0.24, 0.07, 0.012, COMBI.red, 0, 0.1, 0.05),
    box(0.01, 0.045, 0.014, COMBI.plate, -0.055, 0.1, 0.05),
    box(0.01, 0.045, 0.014, COMBI.plate, -0.025, 0.1, 0.05),
    box(0.03, 0.01, 0.014, COMBI.plate, -0.04, 0.1, 0.05),
    box(0.012, 0.05, 0.012, COMBI.black, -0.1, 0.045, 0.05),
    box(0.012, 0.05, 0.012, COMBI.black, 0.1, 0.045, 0.05),
  ];
  hotelCache = {
    height: h,
    body: merge([
      box(w, h, d, COMBI.plate, 0, h / 2, 0),
      box(w + 0.006, 0.02, d + 0.006, STREET.concreteDark, 0, 0.01, 0),
      box(0.07, 0.056, 0.01, COMBI.yellow, 0, 0.038, d / 2 + 0.004),
      ...panes([...upper, ...ground], d, 0.06, 0.034, 0.008, STREET.glass),
    ]),
    roof: merge([
      box(w + 0.02, 0.016, d + 0.02, STREET.concreteDark, 0, 0.008, 0),
      rod(0.09, -0.26, -0.09),
      rod(0.12, 0.26, -0.09, 0.06),
      rod(0.07, -0.26, 0.09),
      rod(0.1, 0.26, 0.09, -0.1),
      rod(0.075, -0.13, -0.09),
      ...tank(0.17, -0.04, 0.035, 0.06),
      ...tank(-0.15, -0.02, 0.03, 0.05),
      ...sign.map((g) => g.translate(0, 0.016, 0.0)),
    ]),
    glow: merge(panes([...upper, ...ground], d, 0.064, 0.038, 0.014, "#ffffff")),
  };
  return hotelCache;
}

export const BUILDING_MATERIAL = shared(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
