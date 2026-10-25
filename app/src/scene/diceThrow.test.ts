import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import { DICE_FLOOR, DICE_WALL, type DiceToss, parseDiceToss } from "../../../shared/dice.ts";
import { DIE, FACE_NORMALS } from "./dice.ts";
import { DiceHand } from "./diceHand.ts";
import { automaticToss, faceTurn, framePose, simulateToss } from "./diceThrow.ts";

const UP = new THREE.Vector3(0, 1, 0);
const REST: ConstructorParameters<typeof DiceHand>[0] = [
  { position: { x: -1, y: DICE_FLOOR + DIE / 2, z: 2.5 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  { position: { x: 0, y: DICE_FLOOR + DIE / 2, z: 2.5 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
];

/** Hard throws into corners and walls, straight drops, and dice released overlapping. */
const extremes: DiceToss[] = [
  [17, 0, -20],
  [-20, 3, 0],
  [14, -5, 14],
  [0, 0, 0],
].map(([x, y, z]) =>
  parseDiceToss({
    dice: [-1, 1].map((side) => ({
      position: { x: 3.5 * Math.sign(x!) + side * 0.2, y: 3, z: -3.5 * Math.sign(z!) },
      rotation: { x: 0.3, y: side, z: 0.1, w: 0.9 },
      velocity: { x: x!, y: y!, z: z! },
      spin: { x: 40 * side, y: 0, z: -30 },
    })),
  })!,
);

const tosses = [...extremes, ...Array.from({ length: 16 }, (_, n) => automaticToss(n))];
const throws = tosses.map((toss) => simulateToss(toss));

function released(speed: number) {
  const hand = new DiceHand(REST, { x: -0.5, z: 2.5 });
  for (let i = 0; i < 40; i++) hand.update(1 / 60, () => {});
  const toss = hand.release({ x: 0, y: 0, z: -speed }, { x: 0, y: 0, z: -1 });
  const flight = simulateToss(toss);
  const travel = [0, 1].map((n) => {
    const from = toss.dice[n]!.position;
    const to = framePose(flight, flight.frameCount - 1, n).position;
    return Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2);
  });
  return { flight, travel: (travel[0]! + travel[1]!) / 2 };
}

describe("dice throws", () => {
  test("a toss replays bit for bit, also after a JSON round trip", () => {
    const toss = automaticToss(7);
    const a = simulateToss(toss);
    const b = simulateToss(JSON.parse(JSON.stringify(toss)));
    expect(b.frames).toEqual(a.frames);
    expect(b.impacts).toEqual(a.impacts);
    expect(b.up).toEqual(a.up);
  });

  test("dice stay inside the walls and on or above the board, and never pass through each other", () => {
    for (const flight of throws)
      for (let frame = 0; frame < flight.frameCount; frame++) {
        const [a, b] = [0, 1].map((n) => framePose(flight, frame, n).position);
        for (const p of [a!, b!]) {
          expect(Math.abs(p.x)).toBeLessThan(DICE_WALL - DIE / 2 + 0.03);
          expect(Math.abs(p.z)).toBeLessThan(DICE_WALL - DIE / 2 + 0.03);
          expect(p.y).toBeGreaterThan(DICE_FLOOR + DIE / 2 - 0.03);
        }
        if (frame > 30)
          expect(new THREE.Vector3(a!.x - b!.x, a!.y - b!.y, a!.z - b!.z).length()).toBeGreaterThan(DIE * 0.9);
      }
  });

  test("dice settle flat on the board, apart, and still", () => {
    for (const flight of throws) {
      const last = flight.frameCount - 1;
      const [a, b] = [0, 1].map((n) => framePose(flight, last, n));
      for (const [n, pose] of [a!, b!].entries()) {
        expect(pose.position.y).toBeCloseTo(DICE_FLOOR + DIE / 2, 1);
        const q = new THREE.Quaternion(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
        expect(flight.up[n]!.clone().applyQuaternion(q).dot(UP)).toBeGreaterThan(0.995);
        const before = framePose(flight, last - 6, n).position;
        expect(Math.abs(before.x - pose.position.x) + Math.abs(before.z - pose.position.z)).toBeLessThan(0.01);
      }
      const gap = Math.hypot(a!.position.x - b!.position.x, a!.position.z - b!.position.z);
      expect(gap).toBeGreaterThanOrEqual(DIE * 0.99);
    }
  });

  test("every value can be turned to face up on whichever side a die lands", () => {
    for (const flight of throws.slice(0, 6))
      for (let value = 1; value <= 6; value++)
        for (const n of [0, 1]) {
          const r = framePose(flight, flight.frameCount - 1, n).rotation;
          const body = new THREE.Quaternion(r.x, r.y, r.z, r.w);
          const top = FACE_NORMALS[value]!.clone()
            .applyQuaternion(faceTurn(value, flight.up[n]!))
            .applyQuaternion(body);
          expect(top.dot(UP)).toBeGreaterThan(0.995);
        }
  });

  test("impacts happen during the throw and are loudest for hard throws", () => {
    const gentle = released(1).flight.impacts;
    const hard = released(16).flight.impacts;
    for (const hit of [...gentle, ...hard]) expect(hit.strength).toBeGreaterThan(0);
    expect(Math.max(...hard.map((h) => h.strength))).toBeGreaterThan(Math.max(...gentle.map((h) => h.strength)));
    expect(hard.some((h) => h.surface === "wall")).toBe(true);
  });

  test("a harder fling travels farther, and letting go without moving still rolls a little", () => {
    const [still, gentle, medium, hard] = [0, 3, 8, 16].map((speed) => released(speed).travel);
    expect(still).toBeGreaterThan(0.25);
    expect(gentle).toBeLessThan(medium!);
    expect(medium).toBeLessThan(hard!);
  });

  test("shaking the hand rattles the dice against it and each other", () => {
    const hand = new DiceHand(REST, { x: 0, z: 2 });
    const hits = { hand: 0, die: 0 };
    for (let i = 0; i < 120; i++) {
      hand.moveTo({ x: i % 16 < 8 ? -0.9 : 0.9, z: 2 });
      hand.update(1 / 60, (_, surface) => hits[surface]++);
    }
    expect(hits.hand).toBeGreaterThan(5);
    expect(hits.die).toBeGreaterThan(0);
    expect(hand.shake).toBeGreaterThan(0.2);
    const [a, b] = hand.poses();
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThan(DIE * 0.9);
  });

  test("button throws differ from one roll to the next", () => {
    expect(automaticToss(1)).not.toEqual(automaticToss(2));
    expect(automaticToss(3)).toEqual(automaticToss(3));
  });
});
