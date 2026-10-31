import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import * as THREE from "three";

import type { DiceToss } from "../../../shared/dice.ts";
import type { PublicState } from "../../../shared/game.ts";
import { FACE_NORMALS } from "./dice.ts";
import type { DiceRig as Rig } from "./DiceRig.ts";

const FRAME = 1000 / 120;
let clock = 1000;
const realNow = performance.now.bind(performance);
let DiceRig: typeof Rig;

beforeAll(async () => {
  performance.now = () => clock;
  Object.assign(globalThis, {
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false }),
  });
  ({ DiceRig } = await import("./DiceRig.ts"));
});

afterAll(() => {
  performance.now = realNow;
});

const state = (rollId: number, dice: [number, number] | null, diceToss: DiceToss | null = null) =>
  ({ rollId, dice, diceToss }) as unknown as PublicState;

/** A rig at rest showing 3 and 4, with our throws caught in `tosses`. */
function setup() {
  const canvas = { style: {}, hasPointerCapture: () => false } as unknown as HTMLCanvasElement;
  const controls = { enabled: true } as ConstructorParameters<typeof Rig>[3];
  const rig = new DiceRig(new THREE.Scene(), new THREE.PerspectiveCamera(), canvas, controls);
  const dice = (rig as unknown as { dice: { body: THREE.Group; model: THREE.Group }[] }).dice;
  const tosses: DiceToss[] = [];
  rig.sync(state(0, [3, 4]));
  rig.setInput({ onHold() {}, onRoll: (toss) => tosses.push(toss) });
  rig.setEnabled(true);
  rig.animate(clock, 0);
  return { rig, dice, tosses };
}

function run(rig: Rig, ms: number, each?: () => void) {
  for (let t = 0; t < ms; t += FRAME) {
    clock += FRAME;
    rig.animate(clock, FRAME / 1000);
    each?.();
  }
}

const positions = (dice: { body: THREE.Group }[]) => dice.map((d) => d.body.position.clone());

function faces(dice: { body: THREE.Group; model: THREE.Group }[]): number[] {
  return dice.map((d) => {
    const q = d.body.quaternion.clone().multiply(d.model.quaternion);
    return [1, 2, 3, 4, 5, 6].reduce((top, v) =>
      FACE_NORMALS[v]!.clone().applyQuaternion(q).y > FACE_NORMALS[top]!.clone().applyQuaternion(q).y ? v : top,
    );
  });
}

function flight(listen: boolean) {
  const { rig, dice, tosses } = setup();
  const hits: number[] = [];
  if (listen) rig.onImpact = (strength) => hits.push(strength);
  rig.throwFromButton();
  run(rig, 300);
  rig.sync(state(1, [6, 2], tosses[0]!));
  run(rig, rig.landsAt - clock + FRAME);
  return { hits, resting: positions(dice) };
}

describe("our own throw", () => {
  test("flies before the server answers and lands on the values it sends", () => {
    const { rig, dice, tosses } = setup();
    const start = clock;
    expect(rig.throwFromButton()).toBe(true);
    const toss = tosses[0]!;
    let closest = Infinity;
    let reached = 0;
    run(rig, 600, () => {
      const gap = Math.max(...dice.map((d, n) => d.body.position.distanceTo(toss.dice[n]!.position as THREE.Vector3)));
      if (gap < closest) [closest, reached] = [gap, clock - start];
    });
    // The replay's first frame plays at the end of the scoop, with no answer yet.
    expect(reached).toBeCloseTo(300, -1);
    expect(rig.landed(1)).toBe(false);

    rig.sync(state(1, [6, 2], toss));
    const landsAt = rig.landsAt;
    expect(landsAt).toBeGreaterThan(clock);
    run(rig, landsAt - clock - FRAME);
    expect(rig.landed(1)).toBe(false);
    run(rig, 2 * FRAME);
    expect(rig.landed(1)).toBe(true);
    expect(faces(dice)).toEqual([6, 2]);
  });

  test("reports each impact as it plays, without changing where the dice go", () => {
    const watched = flight(true);
    expect(watched.hits.length).toBeGreaterThan(0);
    expect(watched.hits.every((s) => s > 0 && s <= 1)).toBe(true);
    expect(flight(false).resting).toEqual(watched.resting);
  });

  test("hovers while the values are late, then flies on", () => {
    const { rig, dice, tosses } = setup();
    rig.throwFromButton();
    run(rig, 1500);
    const hovering = positions(dice);
    run(rig, 500);
    expect(Math.max(...positions(dice).map((p, n) => p.distanceTo(hovering[n]!)))).toBeLessThan(0.05);

    rig.sync(state(1, [5, 1], tosses[0]!));
    run(rig, 300);
    expect(Math.max(...positions(dice).map((p, n) => p.distanceTo(hovering[n]!)))).toBeGreaterThan(0.5);
    run(rig, rig.landsAt - clock + FRAME);
    expect(rig.landed(1)).toBe(true);
    expect(faces(dice)).toEqual([5, 1]);
  });

  test("goes back to rest with its old faces when the server never answers", () => {
    const { rig, dice } = setup();
    const rest = positions(dice);
    rig.throwFromButton();
    run(rig, 4000);
    rig.cancel();
    run(rig, 500);
    expect(Math.max(...positions(dice).map((p, n) => p.distanceTo(rest[n]!)))).toBeLessThan(1e-6);
    expect(faces(dice)).toEqual([3, 4]);
    expect(rig.landsAt).toBe(0);
  });
});

const pose = (x: number) => ({ position: { x, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });

test("someone else's hold leaves the dice on the board", () => {
  const { rig, dice } = setup();
  const rest = positions(dice);
  rig.setInput(null);
  for (let i = 0; i < 6; i++) {
    rig.showHold({ dice: [pose(i), pose(i + 0.7)], shake: 0.5 });
    run(rig, 80);
  }
  expect(Math.max(...positions(dice).map((p, n) => p.distanceTo(rest[n]!)))).toBe(0);
});
