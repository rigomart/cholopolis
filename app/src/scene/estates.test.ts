import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import type { PublicState } from "../../../shared/game.ts";
import { HOTEL } from "../../../shared/game.ts";
import { hotelGeometry, houseGeometry } from "./buildings.ts";
import { HOTEL_MS, HOUSE_MS } from "./construction.ts";
import { disposeTree, type Effects, type Tween } from "./effects.ts";
import { Estates, setWindowGlow } from "./estates.ts";

/** Records what the scene would animate, replacing a tween on the same target like the real one. */
function fakeEffects() {
  const log = { tweens: [] as Tween[], dusts: 0 };
  const effects = {
    add(tween: Tween) {
      if (tween.target) log.tweens = log.tweens.filter((t) => t.target !== tween.target);
      log.tweens.push(tween);
    },
    dust() {
      log.dusts++;
    },
  } as unknown as Effects;
  /** Runs every tween to its end. */
  const finish = () => {
    for (const t of log.tweens.splice(0)) {
      t.step(1);
      t.done?.();
    }
  };
  return { effects, log, finish };
}

/** The first square of the board's browns and its neighbours are streets (indices 1, 3). */
function stateWith(houses: Record<number, number>): PublicState {
  const props = Array.from({ length: 40 }, () => null) as PublicState["props"];
  for (const [index, count] of Object.entries(houses)) {
    props[Number(index)] = { owner: null, houses: count, mortgaged: false };
  }
  return { props, players: [] } as unknown as PublicState;
}

function setup() {
  const scene = new THREE.Scene();
  const fx = fakeEffects();
  const estates = new Estates(scene, fx.effects, 0);
  return { scene, estates, ...fx };
}

const finished = new Set<THREE.BufferGeometry>(
  [houseGeometry(), hotelGeometry()].flatMap((g) => [g.body, g.roof, g.glow]),
);

function countTemporaryMeshes(scene: THREE.Scene): number {
  let count = 0;
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && !finished.has(o.geometry)) count++;
  });
  return count;
}

describe("Estates.sync", () => {
  test("shows buildings at once, with no scaffolding, when not animating", () => {
    const { scene, estates, log } = setup();
    estates.sync(stateWith({ 1: 2, 3: HOTEL }), false);
    expect(log.tweens).toHaveLength(0);
    expect(scene.children).toHaveLength(3);
    expect(countTemporaryMeshes(scene)).toBe(0);
  });

  test("builds a new house under scaffolding, which is gone when it ends", () => {
    const { scene, estates, log, finish } = setup();
    estates.sync(stateWith({ 1: 0 }), true);
    expect(scene.children).toHaveLength(0);
    estates.sync(stateWith({ 1: 1 }), true);
    expect(log.tweens).toHaveLength(1);
    expect(log.tweens[0]?.ms).toBe(HOUSE_MS);
    expect(countTemporaryMeshes(scene)).toBeGreaterThan(0);
    finish();
    expect(countTemporaryMeshes(scene)).toBe(0);
    expect(scene.children).toHaveLength(1);
  });

  test("builds a hotel under a crane, knocks the houses down, and builds only after they are gone", () => {
    const { scene, estates, log, finish } = setup();
    estates.sync(stateWith({ 1: 4 }), false);
    const houses = [...scene.children];
    estates.sync(stateWith({ 1: HOTEL }), true);
    const hotel = log.tweens.find((t) => t.ms === HOTEL_MS);
    const knocked = log.tweens.filter((t) => t.ms !== HOTEL_MS);
    expect(hotel).toBeDefined();
    expect(knocked).toHaveLength(4);
    expect(knocked.every((t) => t.ms < 600)).toBe(true);
    expect(hotel?.start).toBeGreaterThan(Math.max(...knocked.map((t) => t.start)));
    expect(countTemporaryMeshes(scene)).toBeGreaterThan(0);
    finish();
    expect(countTemporaryMeshes(scene)).toBe(0);
    expect(scene.children).toHaveLength(1);
    expect(houses.some((h) => scene.children.includes(h))).toBe(false);
  });

  test("starts several new buildings a beat apart", () => {
    const { estates, log } = setup();
    estates.sync(stateWith({ 1: 0, 3: 0, 6: 0 }), true);
    estates.sync(stateWith({ 1: 1, 3: 1, 6: 1 }), true);
    const starts = log.tweens.map((t) => t.start);
    expect(starts).toHaveLength(3);
    expect(starts[1] ?? 0).toBeGreaterThan(starts[0] ?? 0);
    expect(starts[2] ?? 0).toBeGreaterThan(starts[1] ?? 0);
  });

  test("removes sold buildings quickly and without scaffolding", () => {
    const { scene, estates, log, finish } = setup();
    estates.sync(stateWith({ 1: 3 }), false);
    estates.sync(stateWith({ 1: 2 }), true);
    expect(log.tweens).toHaveLength(1);
    expect(log.tweens[0]?.ms).toBeLessThan(600);
    expect(countTemporaryMeshes(scene)).toBe(0);
    finish();
    expect(scene.children).toHaveLength(2);
  });

  test("selling a hotel brings the houses back quickly, without scaffolding", () => {
    const { scene, estates, log } = setup();
    estates.sync(stateWith({ 1: HOTEL }), false);
    estates.sync(stateWith({ 1: 3 }), true);
    const pops = log.tweens.filter((t) => t.ms < 600);
    expect(pops).toHaveLength(4);
    expect(countTemporaryMeshes(scene)).toBe(0);
  });

  test("selling a building that is still going up leaves nothing behind", () => {
    const { scene, estates, finish } = setup();
    estates.sync(stateWith({ 1: 0 }), true);
    estates.sync(stateWith({ 1: 1 }), true);
    estates.sync(stateWith({ 1: 0 }), true);
    finish();
    expect(scene.children).toHaveLength(0);
  });

  test("a hotel that finishes going up is whole: roof and windows back, no crane", () => {
    const { scene, estates, log } = setup();
    estates.sync(stateWith({ 1: 0 }), true);
    estates.sync(stateWith({ 1: HOTEL }), true);
    const tween = log.tweens[0];
    tween?.step(0.5);
    expect(countTemporaryMeshes(scene)).toBeGreaterThan(0);
    tween?.step(1);
    tween?.done?.();
    expect(countTemporaryMeshes(scene)).toBe(0);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(3);
    expect(meshes.every((m) => m.visible)).toBe(true);
    const hotel = hotelGeometry();
    const roof = meshes.find((m) => m.geometry === hotel.roof);
    expect(roof?.scale.toArray()).toEqual([1, 1, 1]);
    expect(roof?.position.y).toBeCloseTo(hotel.height, 10);
  });

  test("selling a hotel that is still going up takes the crane down first", () => {
    const { scene, estates, log } = setup();
    estates.sync(stateWith({ 1: 0 }), true);
    estates.sync(stateWith({ 1: HOTEL }), true);
    log.tweens[0]?.step(0.5);
    expect(countTemporaryMeshes(scene)).toBeGreaterThan(0);
    estates.sync(stateWith({ 1: 0 }), true);
    expect(countTemporaryMeshes(scene)).toBe(0);
  });
});

function track(scene: THREE.Scene, sharedOnly: boolean) {
  const disposed: string[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const material = o.material as THREE.Material;
    if (!sharedOnly || o.geometry.userData.shared)
      o.geometry.addEventListener("dispose", () => disposed.push("geometry"));
    if (!sharedOnly || material.userData.shared) material.addEventListener("dispose", () => disposed.push("material"));
  });
  return disposed;
}

describe("shared parts", () => {
  test("tearing down a building mid-construction frees its own parts but not the shared scaffolding", () => {
    const { scene, estates } = setup();
    estates.sync(stateWith({ 1: 0 }), true);
    estates.sync(stateWith({ 1: 1 }), true);
    const disposed = track(scene, true);
    for (const child of scene.children) disposeTree(child);
    expect(disposed).toEqual([]);
  });

  test("tearing down a finished building keeps the shared window material", () => {
    const { scene, estates } = setup();
    estates.sync(stateWith({ 1: 1 }), false);
    const disposed = track(scene, true);
    for (const child of scene.children) disposeTree(child);
    expect(disposed).toEqual([]);
  });

  test("a building that finished going up glows at night with the shared windows", () => {
    const { scene, estates, finish } = setup();
    estates.sync(stateWith({ 1: 0 }), true);
    estates.sync(stateWith({ 1: 1 }), true);
    finish();
    setWindowGlow(1);
    const glowing: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry === houseGeometry().glow && o.visible) glowing.push(o);
    });
    expect(glowing).toHaveLength(1);
    const windows = glowing[0]?.material as THREE.MeshBasicMaterial;
    expect(windows.userData.shared).toBe(true);
    expect(windows.visible).toBe(true);
    expect(windows.opacity).toBe(1);
    setWindowGlow(0);
  });
});
