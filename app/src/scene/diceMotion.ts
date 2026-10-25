import * as THREE from "three";

import type { DiceToss } from "../../../shared/dice.ts";
import { DIE, FACE_UP } from "./dice.ts";

export const DICE_STEP = 1 / 120;
export const DICE_FLOOR = 0.35;
export const DICE_HELD_Y = DICE_FLOOR + 1.5;
export const DICE_OFFSETS = [new THREE.Vector3(-0.43, 0, 0.08), new THREE.Vector3(0.43, 0, -0.08)];
const DURATION = 2.4;
const SETTLE_AT = 1.85;
const EDGE = 6;
const Y = new THREE.Vector3(0, 1, 0);

export interface DieFrame {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

export interface DiceThrow {
  dice: [DieFrame[], DieFrame[]];
  impacts: { at: number; strength: number }[];
  duration: number;
}

export function automaticToss(): DiceToss {
  return {
    point: { x: -2.8, z: 2.9 },
    velocity: { x: 4.8, z: -3.6 },
    spin: { x: -16, y: 7, z: -12 },
    rotation: { x: 0.4, y: 0.2, z: -0.3 },
  };
}

export function supportHeight(q: THREE.Quaternion): number {
  const up = Y.clone().applyQuaternion(q.clone().invert());
  return (DIE / 2) * (Math.abs(up.x) + Math.abs(up.y) + Math.abs(up.z));
}

export function simulateThrow(toss: DiceToss, values: [number, number], rollId: number): DiceThrow {
  const result: DiceThrow = { dice: [[], []], impacts: [], duration: DURATION };
  const bodies = DICE_OFFSETS.map((offset, n) => {
    const yaw = (rollId * 1.618 + n * 2.4) % (Math.PI * 2);
    return {
      position: new THREE.Vector3(toss.point.x, DICE_HELD_Y, toss.point.z).add(offset),
      velocity: new THREE.Vector3(
        toss.velocity.x * (n ? 1.03 : 0.97),
        1.5 + Math.hypot(toss.velocity.x, toss.velocity.z) * 0.16 + n * 0.2,
        toss.velocity.z,
      ),
      rotation: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(toss.rotation.x + n * 0.3, toss.rotation.y, toss.rotation.z),
      ),
      spin: new THREE.Vector3(
        toss.spin.x - toss.velocity.z * 0.3,
        toss.spin.y + n * 2,
        toss.spin.z + toss.velocity.x * 0.3,
      ),
      correction: FACE_UP[values[n] ?? 1]!.clone(),
      final: new THREE.Quaternion().setFromAxisAngle(Y, yaw),
      settleFrom: null as THREE.Quaternion | null,
      lastImpact: -1,
    };
  });

  for (let step = 0; step <= Math.round(DURATION / DICE_STEP); step++) {
    const at = step * DICE_STEP;
    bodies.forEach((body, n) => {
      if (step > 0) {
        body.velocity.y -= 22 * DICE_STEP;
        body.position.addScaledVector(body.velocity, DICE_STEP);
        if (at < SETTLE_AT) {
          const speed = body.spin.length();
          if (speed > 0)
            body.rotation.premultiply(
              new THREE.Quaternion().setFromAxisAngle(body.spin.clone().normalize(), speed * DICE_STEP),
            );
        } else {
          body.settleFrom ??= body.rotation.clone();
          const t = Math.min(1, (at - SETTLE_AT) / (DURATION - SETTLE_AT));
          body.rotation.slerpQuaternions(body.settleFrom, body.final, 1 - (1 - t) ** 3);
          body.velocity.x *= 0.9;
          body.velocity.z *= 0.9;
        }
        for (const axis of ["x", "z"] as const) {
          if (Math.abs(body.position[axis]) > EDGE) {
            body.position[axis] = Math.sign(body.position[axis]) * EDGE;
            body.velocity[axis] *= -0.45;
          }
        }
      }
      const q = body.rotation.clone().multiply(body.correction);
      const floor = DICE_FLOOR + supportHeight(q);
      if (body.position.y <= floor) {
        body.position.y = floor;
        const impact = -body.velocity.y;
        if (impact > 1.2 && at - body.lastImpact > 0.09 && at < SETTLE_AT) {
          result.impacts.push({ at, strength: Math.min(1, impact / 9) });
          body.lastImpact = at;
        }
        body.velocity.y = impact > 1.5 && at < 1.25 ? impact * 0.38 : 0;
        body.velocity.x *= 0.94;
        body.velocity.z *= 0.94;
        body.spin.multiplyScalar(0.93);
      }
      if (step === Math.round(DURATION / DICE_STEP)) {
        body.rotation.copy(body.final);
        q.copy(body.final).multiply(body.correction);
        body.position.y = DICE_FLOOR + DIE / 2;
      }
      result.dice[n === 0 ? 0 : 1].push({ position: body.position.clone(), rotation: q });
    });

    const a = bodies[0]!;
    const b = bodies[1]!;
    const delta = b.position.clone().sub(a.position);
    const distance = delta.length();
    if (distance < DIE * 1.12 && distance > 0.0001) {
      const normal = delta.divideScalar(distance);
      const separation = (DIE * 1.12 - distance) / 2;
      a.position.addScaledVector(normal, -separation);
      b.position.addScaledVector(normal, separation);
      const closing = b.velocity.clone().sub(a.velocity).dot(normal);
      if (closing < 0) {
        a.velocity.addScaledVector(normal, closing * 0.7);
        b.velocity.addScaledVector(normal, -closing * 0.7);
      }
    }
  }
  result.impacts.sort((a, b) => a.at - b.at);
  return result;
}
