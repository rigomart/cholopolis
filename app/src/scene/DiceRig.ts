import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  DICE_FLOOR,
  DICE_HOLD_EXPIRE_MS,
  DICE_HOLD_INTERVAL_MS,
  DICE_HOLD_MAX_MS,
  DICE_SPEED_LIMIT,
  type DiceHold,
  type DicePose,
  type DiceToss,
  parseDiceToss,
} from "../../../shared/dice.ts";
import type { PublicState } from "../../../shared/game.ts";
import { playKnock, startRattle } from "../audio.ts";
import { buildDie, DIE } from "./dice.ts";
import { DiceHand, HAND_HEIGHT, RELEASE_SECONDS } from "./diceHand.ts";
import { automaticToss, type DiceThrow, FRAME_TIME, faceTurn, framePose, simulateToss } from "./diceThrow.ts";

export interface DiceInput {
  onHold: (hold: DiceHold | null) => void;
  onRoll: (toss: DiceToss) => void;
}

interface Die {
  /** Carries the physics pose. */
  body: THREE.Group;
  /** The die model inside, turned so the rolled value ends on top. */
  model: THREE.Group;
  halo: THREE.Mesh;
}

/** Where a die is, how fast it moves, and how it looks: `rotation` is the model's, pips included. */
interface Waypoint {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
}

/** A curve from wherever the dice are into a toss, arriving at its start with its speed. */
interface Lead {
  from: Waypoint[];
  to: Waypoint[];
  start: number;
  ms: number;
}

interface Flight {
  sim: DiceThrow;
  rollId: number;
  /** When the replay's first frame plays; the lead runs until then. */
  start: number;
  lead: Lead | null;
  impactIndex: number;
}

/** Our own throw, sent and waiting for the server's values. Nothing is replayed before they arrive. */
interface Release {
  toss: DiceToss;
  rollId: number;
  /** Toward a spot just short of the toss, where the dice wait if the values are late. */
  lead: Lead | null;
  /** When the replay would start if the values were already here. */
  due: number;
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
/** Time for the dice to turn to their new faces once the values arrive, before the replay starts. */
const MIN_LEAD_MS = 100;
/** The roll button scoops the dice up over this long. */
const SCOOP_MS = 300;
/** Viewers catch up from the last relayed hold over this long. */
const CATCH_UP_MS = 160;
/** A waiting throw stops this many seconds of travel short of its toss. */
const WAIT_SHORT = 0.07;
/** Dice picked up off the board rise at this speed before swinging into the toss. */
const LIFT = new THREE.Vector3(0, 4, 0);
const START_POSES: [DicePose, DicePose] = [
  { position: { x: -3.2, y: DICE_FLOOR + DIE / 2, z: 2.9 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  { position: { x: -2.3, y: DICE_FLOOR + DIE / 2, z: 3.4 }, rotation: { x: 0, y: 0.38, z: 0, w: 0.925 } },
];

const smooth = (t: number) => t * t * (3 - 2 * t);
const toVector = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
const toQuaternion = (q: { x: number; y: number; z: number; w: number }) => new THREE.Quaternion(q.x, q.y, q.z, q.w);
const toPose = (p: THREE.Vector3, q: THREE.Quaternion): DicePose => ({
  position: { x: p.x, y: p.y, z: p.z },
  rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
});

/** Cubic Hermite from each die's `from` to its `to`, matching both speeds; rotations ease between. */
function leadAt(lead: Lead, now: number): Waypoint[] {
  const s = Math.max(0, Math.min(1, (now - lead.start) / lead.ms));
  const d = lead.ms / 1000;
  const s2 = s * s;
  const s3 = s2 * s;
  return lead.from.map((a, n) => {
    const b = lead.to[n]!;
    const position = a.position
      .clone()
      .multiplyScalar(2 * s3 - 3 * s2 + 1)
      .addScaledVector(a.velocity, (s3 - 2 * s2 + s) * d)
      .addScaledVector(b.position, 3 * s2 - 2 * s3)
      .addScaledVector(b.velocity, (s3 - s2) * d);
    const velocity = a.position
      .clone()
      .sub(b.position)
      .multiplyScalar((6 * s2 - 6 * s) / d)
      .addScaledVector(a.velocity, 3 * s2 - 4 * s + 1)
      .addScaledVector(b.velocity, 3 * s2 - 2 * s);
    return { position, velocity, rotation: a.rotation.clone().slerp(b.rotation, smooth(s)) };
  });
}

/**
 * The two dice: picked up and shaken by the player whose turn it is, mirrored live for everyone
 * else, then thrown with physics that every screen replays the same way. Values come only from
 * the server. Each die model is turned inside its body so the rolled value lands on top; that
 * turn is folded into the short lead into the replay, so no face changes once the dice fly.
 */
export class DiceRig {
  private readonly dice: Die[] = [];
  private readonly camera: THREE.Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly controls: OrbitControls;
  private readonly reducedMotion: boolean;
  private rest: [DicePose, DicePose] = structuredClone(START_POSES);
  private flight: Flight | null = null;
  private release: Release | null = null;
  private hold: Hold | null = null;
  private remote: { hold: DiceHold; updated: number; rotations: DicePose["rotation"][] } | null = null;
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

  /** Whether roll `rollId` is on the board: landed, cut short by a later roll, or never animated. */
  landed(rollId: number): boolean {
    if (this.seenRoll < rollId) return false;
    return !(this.flight && this.flight.rollId <= rollId && performance.now() < this.landsAt);
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
      // A toss saved or sent by another version may not parse; the automatic throw stands in.
      const toss = parseDiceToss(state.diceToss) ?? automaticToss(state.rollId);
      const sim = simulateToss(toss);
      const now = performance.now();
      const release = this.release;
      const ours =
        release?.rollId === state.rollId && JSON.stringify(release.toss) === JSON.stringify(toss) ? release : null;
      const fromHand = Boolean(this.hold || this.remote || release);
      const from = this.here(now);
      this.endHold();
      this.release = null;
      this.blend = null;
      this.rest = [framePose(sim, sim.frameCount - 1, 0), framePose(sim, sim.frameCount - 1, 1)];
      this.dice.forEach((die, n) => die.model.quaternion.copy(faceTurn(state.dice![n]!, sim.up[n]!)));
      this.flight = null;
      if (!first && !this.reducedMotion) {
        const ms = ours ? Math.max(MIN_LEAD_MS, ours.due - now) : fromHand ? CATCH_UP_MS : this.pickupMs(from, toss);
        if (!fromHand) for (const w of from) if (w.velocity.lengthSq() < 0.01) w.velocity.copy(LIFT);
        const lead = { from, to: this.tossWaypoints(toss), start: now, ms };
        this.flight = { sim, rollId: state.rollId, start: now + ms, lead, impactIndex: 0 };
      }
    }
    this.seenRoll = state.rollId;
  }

  /** Someone else holding the dice, or letting go without throwing. */
  showHold(hold: DiceHold | null): void {
    if (this.hold || this.flight || this.release) return;
    if (!hold) return this.cancel();
    const rotations = this.remote?.rotations ?? this.dice.map((die) => this.poseOf(die).rotation);
    this.remote = { hold: structuredClone(hold), updated: performance.now(), rotations };
    this.stopRattle ??= startRattle(() => this.remote?.hold.shake ?? 0);
  }

  /** Drops any hold, or a throw the server never answered, and puts the dice back. */
  cancel(): void {
    const notify = Boolean(this.hold || this.release);
    if (!this.hold && !this.remote && !this.release) return;
    this.endHold();
    this.release = null;
    if (this.reducedMotion) this.blend = null;
    else this.blendFromHere(350);
    if (notify) this.input?.onHold(null);
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
    const idle = this.enabled && !this.hold && !this.flight && !this.release;
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
        return this.restPoses();
      }
      hold.hand.update(dt, (strength, surface) => {
        // Dice in a shaken hand collide dozens of times a second; a few knocks read as a rattle.
        if (now - hold.knocked < 45) return;
        hold.knocked = now;
        playKnock(strength * 0.7, surface);
      });
      const poses = hold.hand.poses();
      if (now - hold.relayed >= DICE_HOLD_INTERVAL_MS) {
        hold.relayed = now;
        this.input?.onHold({ dice: poses, shake: hold.hand.shake });
      }
      return poses;
    }

    const remote = this.remote;
    if (remote) {
      if (now - remote.updated > DICE_HOLD_EXPIRE_MS) {
        this.cancel();
        return this.restPoses();
      }
      remote.hold.shake *= Math.exp(-dt * 4);
      // Without motion the dice just follow the thrower's hand, unturned.
      if (this.reducedMotion)
        return remote.hold.dice.map((pose, n) => ({ position: pose.position, rotation: remote.rotations[n]! }));
      // Hold updates arrive a few times a second; ease toward each one.
      const k = 1 - Math.exp(-dt * 14);
      return this.dice.map((die, n) => {
        const target = remote.hold.dice[n]!;
        return {
          position: die.body.position.clone().lerp(toVector(target.position), k),
          rotation: die.body.quaternion.clone().slerp(toQuaternion(target.rotation), k),
        };
      });
    }

    const release = this.release;
    if (release) return release.lead ? this.bodyPoses(leadAt(release.lead, now)) : this.dice.map((d) => this.poseOf(d));

    const flight = this.flight;
    if (!flight) return this.restPoses();
    if (now < flight.start) return flight.lead ? this.bodyPoses(leadAt(flight.lead, now)) : this.restPoses();
    const seconds = (now - flight.start) / 1000;
    const frame = seconds / FRAME_TIME;
    const index = Math.floor(frame);
    while (flight.impactIndex < flight.sim.impacts.length && flight.sim.impacts[flight.impactIndex]!.at <= seconds) {
      const hit = flight.sim.impacts[flight.impactIndex++]!;
      if (seconds - hit.at < 0.1) playKnock(hit.strength, hit.surface);
    }
    if (seconds >= flight.sim.duration) {
      this.flight = null;
      return this.restPoses();
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

  /** The roll button: scoops the dice up and throws them, like a fling. False if the dice can't be thrown now. */
  throwFromButton(): boolean {
    if (!this.enabled || !this.input || this.flight || this.hold || this.release) return false;
    const rollId = this.seenRoll + 1;
    const toss = automaticToss(rollId, this.rest);
    const from = this.here(performance.now());
    for (const w of from) w.velocity.copy(LIFT);
    this.startRelease(toss, rollId, from, SCOOP_MS);
    this.input.onRoll(toss);
    return true;
  }

  /**
   * The first moments of our own throw, played while the server rolls: the dice head for the
   * toss and ease to a stop just short of it. Once the values pick the faces, `sync` leads them
   * from wherever they got to into the replay.
   */
  private startRelease(toss: DiceToss, rollId: number, from: Waypoint[], ms: number): void {
    const now = performance.now();
    this.blend = null;
    const to = this.tossWaypoints(toss).map((w) => ({
      position: w.position.clone().addScaledVector(w.velocity, -WAIT_SHORT),
      velocity: new THREE.Vector3(),
      rotation: w.rotation,
    }));
    this.release = { toss, rollId, lead: this.reducedMotion ? null : { from, to, start: now, ms }, due: now + ms };
  }

  /** Where each die is now, how fast it is going, and how it looks. */
  private here(now: number): Waypoint[] {
    const flight = this.flight;
    const lead = this.release?.lead ?? (flight && now < flight.start ? flight.lead : null);
    if (lead) return leadAt(lead, now);
    return this.dice.map((die, n) => {
      const velocity = new THREE.Vector3();
      if (flight) {
        // Cut short mid-flight: carry on at the replay's speed.
        const index = Math.floor((now - flight.start) / 1000 / FRAME_TIME);
        const a = framePose(flight.sim, index, n).position;
        const b = framePose(flight.sim, index + 1, n).position;
        velocity.subVectors(toVector(b), toVector(a)).divideScalar(FRAME_TIME);
      }
      return {
        position: die.body.position.clone(),
        velocity,
        rotation: die.body.quaternion.clone().multiply(die.model.quaternion),
      };
    });
  }

  private tossWaypoints(toss: DiceToss): Waypoint[] {
    return toss.dice.map((d, n) => ({
      position: toVector(d.position),
      velocity: toVector(d.velocity),
      rotation: toQuaternion(d.rotation).multiply(this.dice[n]!.model.quaternion),
    }));
  }

  /** Longer the farther the dice travel to where the toss starts. */
  private pickupMs(from: Waypoint[], toss: DiceToss): number {
    const distance = Math.max(
      ...from.map((w, n) => {
        const start = toss.dice[n]!.position;
        return Math.hypot(w.position.x - start.x, w.position.z - start.z);
      }),
    );
    return Math.min(650, 340 + distance * 45);
  }

  /** Body poses that make the dice look like `points`. */
  private bodyPoses(points: Waypoint[]): DicePose[] {
    return points.map((w, n) =>
      toPose(w.position, w.rotation.clone().multiply(this.dice[n]!.model.quaternion.clone().invert())),
    );
  }

  private restPoses(): DicePose[] {
    return this.rest.map((p) => structuredClone(p));
  }

  private poseOf(die: Die): DicePose {
    return toPose(die.body.position, die.body.quaternion);
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
    const busy = this.flight || this.hold || this.release;
    return this.enabled && Boolean(this.input) && !busy && this.overDice(e);
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
    const from = this.dice.map((die) => this.poseOf(die)) as [DicePose, DicePose];
    this.hold = {
      hand: new DiceHand(from, point, this.reducedMotion),
      pointerId: e.pointerId,
      samples: [{ ...point, at: now }],
      started: now,
      relayed: now,
      knocked: 0,
    };
    this.controls.enabled = false;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = "grabbing";
    this.input?.onHold({ dice: this.hold.hand.poses(), shake: 0 });
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
    const speeds = hold.hand.velocities();
    const from = this.here(performance.now());
    from.forEach((w, n) => w.velocity.copy(toVector(speeds[n]!)));
    this.endHold();
    this.startRelease(toss, this.seenRoll + 1, from, RELEASE_SECONDS * 1000);
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
