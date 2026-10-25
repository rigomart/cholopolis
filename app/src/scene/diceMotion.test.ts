import { expect, test } from "bun:test";

import * as THREE from "three";

import { type DiceToss } from "../../../shared/dice.ts";
import { DIE, FACE_UP } from "./dice.ts";
import { automaticToss, simulateThrow, supportHeight } from "./diceMotion.ts";

test("replaying a throw gives identical paths, impacts and resting poses", () => {
  const a = simulateThrow(automaticToss(), [2, 6], 9);
  expect(simulateThrow(automaticToss(), [2, 6], 9)).toEqual(a);
  expect(a.impacts.length).toBeGreaterThan(2);
  expect(a.impacts.every((hit) => hit.at > 0 && hit.at < a.duration && hit.strength > 0)).toBe(true);
});

test("flick direction and speed affect the flight", () => {
  const toss = automaticToss();
  toss.point = { x: 0, z: 0 };
  const right = simulateThrow({ ...toss, velocity: { x: 8, z: 0 } }, [1, 1], 1);
  const left = simulateThrow({ ...toss, velocity: { x: -8, z: 0 } }, [1, 1], 1);
  const slow = simulateThrow({ ...toss, velocity: { x: 2, z: 0 } }, [1, 1], 1);
  expect(right.dice[0][20]!.position.x).toBeGreaterThan(slow.dice[0][20]!.position.x);
  expect(left.dice[0][20]!.position.x).toBeLessThan(0);
});

test("every server value lands face-up, inside the board and above its surface", () => {
  const tossed: DiceToss[] = [
    automaticToss(),
    {
      point: { x: 5, z: -5 },
      velocity: { x: 8, z: -8 },
      spin: { x: 20, y: 10, z: -20 },
      rotation: { x: 3, y: -2, z: 1 },
    },
    { point: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
  ];
  for (const toss of tossed)
    for (let value = 1; value <= 6; value++) {
      const flight = simulateThrow(toss, [value, 7 - value], value);
      flight.dice.forEach((frames, n) => {
        for (const frame of frames) {
          expect(frame.position.y + 1e-6).toBeGreaterThanOrEqual(0.35 + supportHeight(frame.rotation));
          expect(Math.abs(frame.position.x)).toBeLessThanOrEqual(6.1);
          expect(Math.abs(frame.position.z)).toBeLessThanOrEqual(6.1);
        }
        const last = frames.at(-1)!;
        const up = new THREE.Vector3(0, 1, 0)
          .applyQuaternion(FACE_UP[n ? 7 - value : value]!.clone().invert())
          .applyQuaternion(last.rotation);
        expect(up.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6);
        expect(last.position.y).toBeCloseTo(0.35 + DIE / 2, 6);
      });
      expect(flight.dice[0].at(-1)!.position.distanceTo(flight.dice[1].at(-1)!.position)).toBeGreaterThanOrEqual(DIE);
    }
});
