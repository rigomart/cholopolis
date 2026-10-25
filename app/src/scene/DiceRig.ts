import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  DICE_DRAG_EXPIRE_MS,
  DICE_DRAG_INTERVAL_MS,
  DICE_FLOOR,
  DICE_HOLD_MAX_MS,
  DICE_SPEED_LIMIT,
  type DiceDrag,
  type DicePose,
  type DiceToss,
} from "../../../shared/dice.ts";
import type { PublicState } from "../../../shared/game.ts";
import { playKnock, startRattle } from "../audio.ts";
import { buildDie, DIE } from "./dice.ts";
import { DiceHand, HAND_HEIGHT } from "./diceHand.ts";
import { automaticToss, type DiceThrow, FRAME_TIME, faceTurn, framePose, simulateToss } from "./diceThrow.ts";

export interface DiceInput {
  onDrag: (drag: DiceDrag | null) => void;
  onRoll: (toss: DiceToss) => void;
}

interface Die {
  /** Carries the physics pose. */
  body: THREE.Group;
  /** The die model inside, turned so the rolled value ends on top. */
  model: THREE.Group;
  halo: THREE.Mesh;
}

interface Flight {
  sim: DiceThrow;
  toss: DiceToss;
  rollId: number;
  start: number;
  impactIndex: number;
  /** Thrown here and still waiting for the server's values. */
  pending: boolean;
}

interface Hold {
  hand: DiceHand;
  pointerId: number;
  samples: { x: number; z: number; at: number }[];
  started: number;
  relayed: number;
  knocked: number;
}

/** Fling speed is read from the pointer over this much recent history. */
const FLING_WINDOW_MS = 110;
const START_POSES: [DicePose, DicePose] = [
  { position: { x: -3.2, y: DICE_FLOOR + DIE / 2, z: 2.9 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  { position: { x: -2.3, y: DICE_FLOOR + DIE / 2, z: 3.4 }, rotation: { x: 0, y: 0.38, z: 0, w: 0.925 } },
];

const smooth = (t: number) => t * t * (3 - 2 * t);
const toVector = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
const toQuaternion = (q: { x: number; y: number; z: number; w: number }) => new THREE.Quaternion(q.x, q.y, q.z, q.w);

/**
 * The two dice: picked up and shaken by the player whose turn it is, mirrored live for everyone
 * else, then thrown with physics that every screen replays the same way. Values come only from
 * the server; each die model is turned inside its body so the rolled value lands on top.
 */
export class DiceRig {
  private readonly dice: Die[] = [];
  private readonly camera: THREE.Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly controls: OrbitControls;
  private readonly reducedMotion: boolean;
  private rest: [DicePose, DicePose] = structuredClone(START_POSES);
  private flight: Flight | null = null;
  private hold: Hold | null = null;
  private remote: { drag: DiceDrag; updated: number } | null = null;
  private blend: { from: DicePose[]; start: number; ms: number } | null = null;
  private input: DiceInput | null = null;
  private enabled = false;
  private seenRoll = -1;
  private stopRattle: (() => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera, canvas: HTMLCanvasElement, controls: OrbitControls) {
    this.camera = camera;
    this.canvas = canvas;
    this.controls = controls;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [n, pose] of START_POSES.entries()) {
      const body = new THREE.Group();
      const model = buildDie();
      model.quaternion.copy(faceTurn(n ? 3 : 5, new THREE.Vector3(0, 1, 0)));
      body.add(model);
      body.position.copy(toVector(pose.position));
      body.quaternion.copy(toQuaternion(pose.rotation));
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.46, 0.025, 6, 36),
        new THREE.MeshBasicMaterial({ color: "#ffe500", transparent: true, opacity: 0.65 }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.visible = false;
      scene.add(body, halo);
      this.dice.push({ body, model, halo });
    }
  }

  get held(): boolean {
    return this.hold !== null;
  }

  /** When the current throw comes to rest, in `performance.now()` time; 0 when nothing is rolling. */
  get landsAt(): number {
    return this.flight ? this.flight.start + this.flight.sim.duration * 1000 : 0;
  }

  setInput(input: DiceInput | null): void {
    if (!input) this.cancel();
    this.input = input;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.hold) this.cancel();
    if (!enabled) this.canvas.style.cursor = "";
  }

  sync(state: PublicState | null): void {
    if (!state) return this.cancel();
    const first = this.seenRoll === -1;
    if (state.dice && state.rollId !== this.seenRoll) {
      const flight = this.flight;
      const toss = state.toss ?? automaticToss(state.rollId);
      let sim: DiceThrow;
      if (flight?.pending && flight.rollId === state.rollId && JSON.stringify(flight.toss) === JSON.stringify(toss)) {
        // Our own throw, already in the air: only the values were missing.
        sim = flight.sim;
        flight.pending = false;
        this.rest = this.finalPoses(sim);
        if (this.reducedMotion) this.flight = null;
      } else {
        const fromHand = Boolean(this.hold || this.remote);
        this.endHold();
        sim = this.throw(toss, state.rollId, !first && !this.reducedMotion, false, fromHand ? 150 : 320);
      }
      this.dice.forEach((die, n) => die.model.quaternion.copy(faceTurn(state.dice![n]!, sim.up[n]!)));
    }
    this.seenRoll = state.rollId;
  }

  /** Someone else holding the dice, or letting go without throwing. */
  showDrag(drag: DiceDrag | null): void {
    if (this.hold || this.flight) return;
    if (!drag) return this.cancel();
    this.remote = { drag: structuredClone(drag), updated: performance.now() };
    this.stopRattle ??= startRattle(() => this.remote?.drag.shake ?? 0);
  }

  /** Drops any hold, or a throw the server never confirmed, and puts the dice back. */
  cancel(): void {
    const notify = Boolean(this.hold || this.flight?.pending);
    if (!this.hold && !this.remote && !this.flight?.pending) return;
    this.endHold();
    if (this.flight?.pending) this.flight = null;
    this.blendFromHere(350);
    if (notify) this.input?.onDrag(null);
  }

  private endHold(): void {
    const pointerId = this.hold?.pointerId;
    this.hold = null;
    this.remote = null;
    this.stopRattle?.();
    this.stopRattle = null;
    this.controls.enabled = true;
    this.canvas.style.cursor = "";
    if (pointerId !== undefined && this.canvas.hasPointerCapture(pointerId))
      this.canvas.releasePointerCapture(pointerId);
  }

  animate(now: number, dt: number): void {
    const poses = this.currentPoses(now, dt);
    const blend = this.blend;
    if (blend) {
      const t = smooth(Math.min(1, (now - blend.start) / blend.ms));
      if (t >= 1) this.blend = null;
      poses.forEach((pose, n) => {
        const from = blend.from[n]!;
        pose.position = toVector(from.position).lerp(toVector(pose.position), t);
        pose.rotation = toQuaternion(from.rotation).slerp(toQuaternion(pose.rotation), t);
      });
    }
    this.place(poses);
    const idle = this.enabled && !this.hold && !this.flight;
    for (const die of this.dice) {
      die.halo.visible = idle;
      die.halo.position.set(die.body.position.x, DICE_FLOOR + 0.015, die.body.position.z);
    }
  }

  private currentPoses(now: number, dt: number): DicePose[] {
    const hold = this.hold;
    if (hold) {
      if (now - hold.started > DICE_HOLD_MAX_MS) {
        this.cancel();
        return this.rest.map((p) => structuredClone(p));
      }
      hold.hand.update(dt, (strength, surface) => {
        // Dice in a shaken hand collide dozens of times a second; a few knocks read as a rattle.
        if (now - hold.knocked < 45) return;
        hold.knocked = now;
        playKnock(strength * 0.7, surface);
      });
      const poses = hold.hand.poses();
      if (now - hold.relayed >= DICE_DRAG_INTERVAL_MS) {
        hold.relayed = now;
        this.input?.onDrag({ dice: poses, shake: hold.hand.shake });
      }
      return poses;
    }

    const remote = this.remote;
    if (remote) {
      if (now - remote.updated > DICE_DRAG_EXPIRE_MS) {
        this.cancel();
        return this.rest.map((p) => structuredClone(p));
      }
      remote.drag.shake *= Math.exp(-dt * 4);
      // Drag updates arrive a few times a second; ease toward each one.
      const k = 1 - Math.exp(-dt * 14);
      return this.dice.map((die, n) => {
        const target = remote.drag.dice[n]!;
        return {
          position: die.body.position.clone().lerp(toVector(target.position), k),
          rotation: die.body.quaternion.clone().slerp(toQuaternion(target.rotation), k),
        };
      });
    }

    const flight = this.flight;
    if (!flight) return this.rest.map((p) => structuredClone(p));
    if (this.reducedMotion && flight.pending) return this.dice.map((die) => this.poseOf(die));
    const seconds = (now - flight.start) / 1000;
    const frame = seconds / FRAME_TIME;
    const index = Math.floor(frame);
    while (flight.impactIndex < flight.sim.impacts.length && flight.sim.impacts[flight.impactIndex]!.at <= seconds) {
      const hit = flight.sim.impacts[flight.impactIndex++]!;
      if (seconds - hit.at < 0.1) playKnock(hit.strength, hit.surface);
    }
    if (seconds >= flight.sim.duration && !flight.pending) {
      this.flight = null;
      return this.rest.map((p) => structuredClone(p));
    }
    return [0, 1].map((n) => {
      const a = framePose(flight.sim, index, n);
      const b = framePose(flight.sim, index + 1, n);
      return {
        position: toVector(a.position).lerp(toVector(b.position), frame - index),
        rotation: toQuaternion(a.rotation).slerp(toQuaternion(b.rotation), frame - index),
      };
    });
  }

  /** The roll button: an automatic throw played here at once, like a fling. False if the dice can't be thrown now. */
  throwFromButton(): boolean {
    if (!this.enabled || !this.input || this.flight || this.hold) return false;
    const rollId = this.seenRoll + 1;
    const toss = automaticToss(rollId, this.rest);
    this.throw(toss, rollId, !this.reducedMotion, true, 260);
    this.input.onRoll(toss);
    return true;
  }

  /**
   * Starts playing a toss. Remote viewers catch up from the last relayed hold, and automatic
   * throws lift off the board, over `blendMs`; a fling continues straight from the hand.
   */
  private throw(toss: DiceToss, rollId: number, animate: boolean, pending: boolean, blendMs = 0): DiceThrow {
    const sim = simulateToss(toss);
    if (!pending) this.rest = this.finalPoses(sim);
    this.blend = null;
    if (animate && blendMs > 0) this.blendFromHere(blendMs);
    this.flight = animate || pending ? { sim, toss, rollId, start: performance.now(), impactIndex: 0, pending } : null;
    return sim;
  }

  private finalPoses(sim: DiceThrow): [DicePose, DicePose] {
    return [framePose(sim, sim.frameCount - 1, 0), framePose(sim, sim.frameCount - 1, 1)];
  }

  private poseOf(die: Die): DicePose {
    const { position: p, quaternion: q } = die.body;
    return { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w } };
  }

  private blendFromHere(ms: number): void {
    this.blend = { from: this.dice.map((die) => this.poseOf(die)), start: performance.now(), ms };
  }

  private place(poses: DicePose[]): void {
    this.dice.forEach((die, n) => {
      const pose = poses[n]!;
      die.body.position.copy(toVector(pose.position));
      die.body.quaternion.copy(toQuaternion(pose.rotation)).normalize();
    });
  }

  // ---------------------------------------------------------------- pointer

  private ray(e: PointerEvent): THREE.Raycaster {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    return ray;
  }

  /** Where the pointer meets the plane the hand moves in. */
  private handPoint(e: PointerEvent): { x: number; z: number } | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HAND_HEIGHT);
    const point = this.ray(e).ray.intersectPlane(plane, new THREE.Vector3());
    return point ? { x: point.x, z: point.z } : null;
  }

  private overDice(e: PointerEvent): boolean {
    if (this.ray(e).intersectObjects(this.dice.map((d) => d.body)).length > 0) return true;
    const rect = this.canvas.getBoundingClientRect();
    const reach = e.pointerType === "touch" ? 34 : 18;
    return this.dice.some((die) => {
      const p = die.body.position.clone().project(this.camera);
      const x = rect.left + ((p.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - p.y) * rect.height) / 2;
      return Math.hypot(e.clientX - x, e.clientY - y) <= reach;
    });
  }

  private canGrab(e: PointerEvent): boolean {
    return this.enabled && Boolean(this.input) && !this.flight && !this.hold && this.overDice(e);
  }

  /** Returns true when the pointer picked up the dice, so the camera should ignore it. */
  pointerDown(e: PointerEvent): boolean {
    if (this.hold) return true;
    if (e.button !== 0 || !e.isPrimary || !this.canGrab(e)) return false;
    const point = this.handPoint(e);
    if (!point) return false;
    const now = performance.now();
    this.remote = null;
    this.blend = null;
    this.hold = {
      hand: new DiceHand(this.dice.map((die) => this.poseOf(die)) as [DicePose, DicePose], point),
      pointerId: e.pointerId,
      samples: [{ ...point, at: now }],
      started: now,
      relayed: now,
      knocked: 0,
    };
    this.controls.enabled = false;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = "grabbing";
    this.input?.onDrag({ dice: this.hold.hand.poses(), shake: 0 });
    return true;
  }

  pointerMove(e: PointerEvent): void {
    const hold = this.hold;
    if (!hold) {
      this.canvas.style.cursor = e.pointerType === "mouse" && this.canGrab(e) ? "grab" : "";
      return;
    }
    if (e.pointerId !== hold.pointerId) return;
    // Coalesced events keep the full path on fast flicks, so the release speed is honest.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    for (const event of coalesced.length > 0 ? coalesced : [e]) {
      const point = this.handPoint(event);
      if (point) hold.samples.push({ ...point, at: event.timeStamp });
    }
    const last = hold.samples.at(-1)!;
    hold.hand.moveTo(last);
    hold.samples = hold.samples.filter((s) => last.at - s.at <= 400);
  }

  /** Returns true when the pointer belonged to a hold. */
  pointerUp(e: PointerEvent): boolean {
    const hold = this.hold;
    if (!hold || e.pointerId !== hold.pointerId) return Boolean(hold);
    this.pointerMove(e);
    const toss = hold.hand.release(this.flingVelocity(hold.samples, e.timeStamp), this.forward());
    this.endHold();
    this.throw(toss, this.seenRoll + 1, true, true);
    this.input?.onRoll(toss);
    return true;
  }

  /**
   * Least-squares slope of the pointer path over the last moments, so one jittery event can't
   * decide the throw. A pointer that stopped before letting go gives almost no speed.
   */
  private flingVelocity(samples: Hold["samples"], now: number): { x: number; y: number; z: number } {
    const recent = samples.filter((s) => now - s.at <= FLING_WINDOW_MS);
    if (recent.length < 2) return { x: 0, y: 0, z: 0 };
    const mean = recent.reduce((m, s) => ({ x: m.x + s.x, z: m.z + s.z, at: m.at + s.at }), { x: 0, z: 0, at: 0 });
    for (const k of ["x", "z", "at"] as const) mean[k] /= recent.length;
    let tt = 0;
    let tx = 0;
    let tz = 0;
    for (const s of recent) {
      const t = (s.at - mean.at) / 1000;
      tt += t * t;
      tx += t * (s.x - mean.x);
      tz += t * (s.z - mean.z);
    }
    if (tt < 1e-6) return { x: 0, y: 0, z: 0 };
    const v = new THREE.Vector3(tx / tt, 0, tz / tt).multiplyScalar(0.8);
    return v.clampLength(0, DICE_SPEED_LIMIT - 3);
  }

  /** Away from the player, along the board. */
  private forward(): THREE.Vector3 {
    const direction = this.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    return direction.lengthSq() > 1e-6 ? direction.normalize() : new THREE.Vector3(0, 0, -1);
  }
}
