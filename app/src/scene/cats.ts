import * as THREE from "three";

import { BOARD } from "../../../shared/board.ts";
import { DICE_FLOOR, DICE_WALL } from "../../../shared/dice.ts";
import { localCenter, sideOf, toBoard } from "./layout.ts";

const SCALE = 1.3;
/** Inside the dice walls; also where cats hop the rail from. */
const ROAM = DICE_WALL - 0.4;
const NAP_LOCAL_Z = 5.62;
const WALK_SPEED = 0.6;
const RUN_SPEED = 3.4;
const KEEP_APART = 0.55;
const KEEP_FROM_DICE = 0.6;
const POKE_RADIUS = 0.3;
/** Seconds a startled cat waits before hopping; uneven, so a group doesn't jump as one. */
const HOP_DELAY = [0.2, 0.32] as const;
const FIRST_VISIT = [14, 30] as const;
const NEXT_VISIT = [35, 80] as const;
const VISIT_MODES = new Set(["street", "station", "utility"]);

type Mode = "walk" | "run" | "hop" | "leap" | "sit" | "groom" | "sleep";

interface Leap {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  t: number;
  after: "nap" | "roam";
}

interface Visit {
  square: number;
  stage: "approach" | "nap" | "leave";
}

export interface Cat {
  x: number;
  z: number;
  heading: number;
  mode: Mode;
  /** Seconds left in a sit, groom, sleep or hop. */
  timer: number;
  targetX: number;
  targetZ: number;
  speed: number;
  /** Seconds left before the cat stops trying to reach its target. */
  timeout: number;
  /** Seconds the cat stays alert after being poked or startled. */
  alert: number;
  leap: Leap | null;
  visit: Visit | null;
  onRing: boolean;
  clock: number;
  phase: number;
  /** Eased 0..1 weights of each pose. */
  walk: number;
  sit: number;
  curl: number;
  groom: number;
  root: THREE.Group;
  rig: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  tail: THREE.Group[];
  /** Front left, front right, hind left, hind right. */
  legs: THREE.Group[];
}

interface Coat {
  fur: string;
  mark: string;
  eyes: string;
  marks: "stripes" | "patches" | "none";
}

const COATS: Coat[] = [
  { fur: "#e48a3a", mark: "#b05a1c", eyes: "#2d3b1a", marks: "stripes" },
  { fur: "#2a2632", mark: "#2a2632", eyes: "#f0dc4e", marks: "none" },
  { fur: "#f4efe4", mark: "#e48a3a", eyes: "#3a4a1a", marks: "patches" },
];

const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const headingOf = (dx: number, dz: number) => Math.atan2(-dz, dx);
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

export interface CatOptions {
  reducedMotion: boolean;
  /** Whether a pawn stands on this square; cats keep off those. */
  occupied: (square: number) => boolean;
  random?: () => number;
}

/** Cosmetic, local-only cats wandering the board centre; never shared or sent, never touching game state or the dice. */
export class Cats {
  readonly cats: Cat[] = [];
  private readonly scene: THREE.Scene;
  private readonly options: CatOptions;
  private readonly random: () => number;
  private readonly geometry = {
    sphere: new THREE.SphereGeometry(1, 8, 6),
    cone: new THREE.ConeGeometry(1, 1, 4),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 6),
  };
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly center = new THREE.Vector3();
  private visitIn: number;

  constructor(scene: THREE.Scene, options: CatOptions) {
    this.scene = scene;
    this.options = options;
    this.random = options.random ?? Math.random;
    this.visitIn = this.between(FIRST_VISIT);
    COATS.forEach((coat, n) => {
      const cat = this.build(coat);
      this.placeAwayFromDiceStart(cat, n);
      this.cats.push(cat);
      scene.add(cat.root);
      this.apply(cat, 1);
    });
  }

  dispose(): void {
    for (const cat of this.cats) this.scene.remove(cat.root);
    for (const g of Object.values(this.geometry)) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.cats.length = 0;
  }

  /** Dice landed at `dice` with this strength: cats close by hop and run away. */
  scatter(dice: readonly THREE.Vector3[], strength: number): void {
    if (this.options.reducedMotion) return;
    const radius = 1.3 + 1.7 * clamp(strength, 0, 1);
    for (const cat of this.cats) {
      if (cat.mode === "leap" || cat.onRing) continue;
      let nearest = Infinity;
      let fromX = 0;
      let fromZ = 0;
      for (const die of dice) {
        const d = Math.hypot(cat.x - die.x, cat.z - die.z);
        if (d >= nearest) continue;
        nearest = d;
        fromX = die.x;
        fromZ = die.z;
      }
      if (nearest > radius) continue;
      this.startle(cat, cat.x - fromX, cat.z - fromZ);
    }
  }

  /** A click or tap along `ray`: the cat it passes close to perks up. Returns whether one did. */
  poke(ray: THREE.Ray): boolean {
    let best: Cat | null = null;
    let bestDistance = POKE_RADIUS * POKE_RADIUS;
    for (const cat of this.cats) {
      this.center.set(cat.x, DICE_FLOOR + 0.14 * SCALE, cat.z);
      const d = ray.distanceSqToPoint(this.center);
      if (d >= bestDistance) continue;
      best = cat;
      bestDistance = d;
    }
    if (!best) return false;
    best.alert = this.options.reducedMotion ? 0 : 1.4;
    return true;
  }

  update(dt: number, dice: readonly THREE.Vector3[]): void {
    if (this.options.reducedMotion) return this.clearOfDice(dice);
    this.visitIn -= dt;
    if (this.visitIn <= 0) this.startVisit();
    for (const cat of this.cats) this.step(cat, dt, dice);
    this.separate(dt);
    for (const cat of this.cats) this.apply(cat, dt);
  }

  private between([min, max]: readonly [number, number]): number {
    return min + this.random() * (max - min);
  }

  private placeAwayFromDiceStart(cat: Cat, n: number): void {
    const angle = (n / COATS.length) * Math.PI * 2 + 0.6;
    cat.x = Math.cos(angle) * 2.2;
    cat.z = -Math.sin(angle) * 1.8 - 0.4;
    cat.heading = this.random() * Math.PI * 2;
    cat.mode = n === 1 ? "sleep" : "sit";
    cat.timer = this.between([4, 9]);
    if (this.options.reducedMotion) cat.alert = 0;
  }

  private startle(cat: Cat, awayX: number, awayZ: number): void {
    if (cat.visit) this.endVisit(cat, true);
    const length = Math.hypot(awayX, awayZ);
    const angle = length > 0.01 ? Math.atan2(awayZ, awayX) + (this.random() - 0.5) * 0.9 : this.random() * Math.PI * 2;
    const far = 2 + this.random() * 1.6;
    this.setTarget(cat, cat.x + Math.cos(angle) * far, cat.z + Math.sin(angle) * far);
    cat.mode = "hop";
    cat.timer = this.between(HOP_DELAY);
    cat.alert = 2;
  }

  private setTarget(cat: Cat, x: number, z: number): void {
    cat.targetX = clamp(x, -ROAM, ROAM);
    cat.targetZ = clamp(z, -ROAM, ROAM);
    cat.timeout = Math.hypot(cat.targetX - cat.x, cat.targetZ - cat.z) * 2.5 + 2;
  }

  private idle(cat: Cat): void {
    const r = this.random();
    cat.speed = 0;
    if (r < 0.45) {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 6; tries++) {
        x = (this.random() * 2 - 1) * ROAM;
        z = (this.random() * 2 - 1) * ROAM;
        if (Math.hypot(x - cat.x, z - cat.z) > 1.4) break;
      }
      this.setTarget(cat, x, z);
      cat.mode = "walk";
    } else if (r < 0.7) {
      cat.mode = "groom";
      cat.timer = this.between([3, 5.5]);
    } else if (r < 0.85) {
      cat.mode = "sleep";
      cat.timer = this.between([12, 25]);
    } else {
      cat.mode = "sit";
      cat.timer = this.between([3, 6]);
    }
  }

  private step(cat: Cat, dt: number, dice: readonly THREE.Vector3[]): void {
    cat.clock += dt;
    cat.alert = Math.max(0, cat.alert - dt);
    switch (cat.mode) {
      case "sit":
      case "groom":
      case "sleep":
        this.rest(cat, dt);
        break;
      case "hop":
        this.turn(cat, dt, 16);
        cat.timer -= dt;
        if (cat.timer <= 0) {
          cat.mode = "run";
          cat.speed = 0;
        }
        break;
      case "walk":
      case "run":
        this.travel(cat, dt);
        break;
      case "leap":
        this.fly(cat, dt);
        break;
    }
    if (!cat.onRing && cat.mode !== "leap") this.avoid(cat, dt, dice);
  }

  private rest(cat: Cat, dt: number): void {
    cat.timer -= dt;
    const napping = cat.visit?.stage === "nap";
    if (napping && this.options.occupied(cat.visit!.square)) cat.timer = 0;
    if (cat.timer > 0) return;
    if (!cat.visit) return this.idle(cat);
    if (cat.visit.stage === "nap") {
      cat.visit.stage = "leave";
      cat.mode = "sit";
      cat.timer = 1.1;
      return;
    }
    const { square } = cat.visit;
    const side = sideOf(square);
    const x = localCenter(square).x;
    const from = toBoard({ x, z: NAP_LOCAL_Z }, side);
    const to = toBoard({ x, z: ROAM }, side);
    this.startLeap(cat, from, to, "roam");
  }

  private travel(cat: Cat, dt: number): void {
    const running = cat.mode === "run";
    const dx = cat.targetX - cat.x;
    const dz = cat.targetZ - cat.z;
    const distance = Math.hypot(dx, dz);
    const want = running ? RUN_SPEED : WALK_SPEED;
    if (distance < 0.1) return this.arrive(cat);
    cat.timeout -= dt;
    if (cat.timeout <= 0) return cat.visit?.stage === "approach" ? this.endVisit(cat, false) : this.arrive(cat);
    const off = Math.abs(wrap(headingOf(dx, dz) - cat.heading));
    this.turn(cat, dt, running ? 14 : 6);
    const goal = off > 1 ? want * 0.25 : want;
    cat.speed += (goal - cat.speed) * ease(dt, 8);
    const step = Math.min(distance, cat.speed * dt);
    cat.x += Math.cos(cat.heading) * step;
    cat.z -= Math.sin(cat.heading) * step;
    cat.phase += dt * (3 + cat.speed * 4.5);
  }

  private turn(cat: Cat, dt: number, rate: number): void {
    const dx = cat.targetX - cat.x;
    const dz = cat.targetZ - cat.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    const diff = wrap(headingOf(dx, dz) - cat.heading);
    cat.heading += clamp(diff, -rate * dt, rate * dt);
  }

  private arrive(cat: Cat): void {
    cat.speed = 0;
    const visit = cat.visit;
    if (visit?.stage === "approach") {
      if (this.options.occupied(visit.square)) return this.endVisit(cat, false);
      const side = sideOf(visit.square);
      const x = localCenter(visit.square).x;
      const from = toBoard({ x, z: ROAM }, side);
      const to = toBoard({ x, z: NAP_LOCAL_Z }, side);
      return this.startLeap(cat, from, to, "nap");
    }
    cat.mode = "sit";
    cat.timer = this.between([1.5, 4]);
  }

  private startLeap(
    cat: Cat,
    from: { x: number; z: number },
    to: { x: number; z: number },
    after: Leap["after"],
  ): void {
    cat.leap = { fromX: from.x, fromZ: from.z, toX: to.x, toZ: to.z, t: 0, after };
    cat.heading = headingOf(to.x - from.x, to.z - from.z);
    cat.mode = "leap";
  }

  private fly(cat: Cat, dt: number): void {
    const leap = cat.leap;
    if (!leap) return;
    leap.t = Math.min(1, leap.t + dt / 0.8);
    const e = leap.t * leap.t * (3 - 2 * leap.t);
    cat.x = lerp(leap.fromX, leap.toX, e);
    cat.z = lerp(leap.fromZ, leap.toZ, e);
    cat.phase += dt * 10;
    if (leap.t < 1) return;
    cat.leap = null;
    cat.speed = 0;
    if (leap.after === "nap") {
      const side = sideOf(cat.visit?.square ?? 0);
      const along = toBoard({ x: -1, z: 0 }, side);
      cat.onRing = true;
      cat.heading = headingOf(along.x, along.z);
      cat.mode = "sleep";
      cat.timer = this.between([25, 45]);
      if (cat.visit) cat.visit.stage = "nap";
    } else {
      cat.onRing = false;
      this.endVisit(cat, false);
    }
  }

  private startVisit(): void {
    this.visitIn = this.between([8, 15]);
    if (this.cats.some((c) => c.visit)) return;
    const squares: number[] = [];
    BOARD.forEach((square, index) => {
      if (VISIT_MODES.has(square.kind) && !this.options.occupied(index)) squares.push(index);
    });
    const candidates = this.cats.filter((c) => c.mode === "walk" || c.mode === "sit" || c.mode === "groom");
    const cat = candidates[Math.floor(this.random() * candidates.length)];
    const square = squares[Math.floor(this.random() * squares.length)];
    if (!cat || square === undefined) return;
    const { x } = localCenter(square);
    const wait = toBoard({ x, z: ROAM }, sideOf(square));
    cat.visit = { square, stage: "approach" };
    this.setTarget(cat, wait.x, wait.z);
    cat.mode = "walk";
    this.visitIn = this.between(NEXT_VISIT);
  }

  private endVisit(cat: Cat, scared: boolean): void {
    cat.visit = null;
    cat.leap = null;
    cat.onRing = false;
    if (!scared) this.idle(cat);
  }

  private avoid(cat: Cat, dt: number, dice: readonly THREE.Vector3[]): void {
    for (const die of dice) {
      if (die.y > DICE_FLOOR + 0.8) continue;
      const dx = cat.x - die.x;
      const dz = cat.z - die.z;
      const d = Math.hypot(dx, dz);
      if (d >= KEEP_FROM_DICE) continue;
      const push = ((KEEP_FROM_DICE - d) * Math.min(1, dt * 5)) / Math.max(d, 0.01);
      cat.x += dx * push;
      cat.z += dz * push;
    }
    cat.x = clamp(cat.x, -ROAM, ROAM);
    cat.z = clamp(cat.z, -ROAM, ROAM);
  }

  private separate(dt: number): void {
    for (let i = 0; i < this.cats.length; i++) {
      const a = this.cats[i]!;
      for (let j = i + 1; j < this.cats.length; j++) {
        const b = this.cats[j]!;
        if (a.onRing || b.onRing || a.mode === "leap" || b.mode === "leap") continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= KEEP_APART) continue;
        const push = ((KEEP_APART - d) * 0.5 * Math.min(1, dt * 5)) / Math.max(d, 0.01);
        a.x -= dx * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.z += dz * push;
        a.x = clamp(a.x, -ROAM, ROAM);
        a.z = clamp(a.z, -ROAM, ROAM);
        b.x = clamp(b.x, -ROAM, ROAM);
        b.z = clamp(b.z, -ROAM, ROAM);
      }
    }
  }

  private clearOfDice(dice: readonly THREE.Vector3[]): void {
    for (const cat of this.cats) {
      const { x, z } = cat;
      this.avoid(cat, 1, dice);
      if (cat.x !== x || cat.z !== z) this.apply(cat, 1);
    }
  }

  private apply(cat: Cat, dt: number): void {
    const reduced = this.options.reducedMotion;
    const awake = cat.alert > 0;
    const moving = cat.mode === "walk" || cat.mode === "run" || cat.mode === "hop" || cat.mode === "leap";
    const sleeping = cat.mode === "sleep" && !awake;
    const grooming = cat.mode === "groom" && !awake;
    const k = reduced ? 1 : ease(dt, 7);
    cat.walk += ((moving ? 1 : 0) - cat.walk) * k;
    cat.sit += ((!moving && !sleeping ? 1 : 0) - cat.sit) * k;
    cat.curl += ((sleeping ? 1 : 0) - cat.curl) * k;
    cat.groom += ((grooming ? 1 : 0) - cat.groom) * k;

    const { walk, sit, curl, groom, clock } = cat;
    const upright = sit * (1 - curl);
    const run = clamp((cat.speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
    let hopY = 0;
    if (cat.mode === "hop") hopY = Math.sin(clamp(1 - cat.timer / 0.2, 0, 1) * Math.PI) * 0.16;
    if (cat.leap) hopY = Math.sin(cat.leap.t * Math.PI) * 0.45;

    cat.root.position.set(cat.x, DICE_FLOOR + hopY, cat.z);
    cat.root.rotation.y = cat.heading;

    const { rig, body, head } = cat;
    const gait = Math.sin(cat.phase);
    const breath = Math.sin(clock * 2.2) * 0.04 * (curl + upright * 0.4);
    rig.position.set(-0.04 * upright, 0.115 + 0.075 * upright - 0.04 * curl + Math.abs(gait) * 0.012 * walk * run, 0);
    rig.rotation.z = 0.85 * upright + gait * 0.07 * run * walk;
    body.scale.set(lerp(0.17, 0.12, curl), lerp(0.082, 0.07, curl) * (1 + breath), lerp(0.085, 0.115, curl));

    const nod = Math.sin(clock * 9) * 0.12;
    head.position.set(lerp(0.19, 0.12, curl), lerp(0.06, 0.0, curl), lerp(0, 0.1, curl));
    head.rotation.set(0, curl * 2.6, -0.55 * upright + groom * (-0.75 + nod) - curl * 0.1);

    const { legs, tail } = cat;
    const amp = (0.3 + 0.45 * run) * walk;
    const swing = gait * amp;
    const frontLeft = legs[0]!;
    const frontRight = legs[1]!;
    const hindLeft = legs[2]!;
    const hindRight = legs[3]!;
    frontLeft.rotation.z = swing - 0.85 * upright;
    frontRight.rotation.z = -swing - 0.85 * upright + groom * (1.1 + nod);
    hindLeft.rotation.z = -swing - 0.85 * upright * 1.4;
    hindRight.rotation.z = swing - 0.85 * upright * 1.4;
    const front = 1 + 2.1 * upright;
    const hind = 1 - 0.4 * upright;
    frontLeft.scale.y = frontRight.scale.y = Math.max(0.01, front * (1 - curl));
    hindLeft.scale.y = hindRight.scale.y = Math.max(0.01, hind * (1 - curl));

    const swish = reduced ? 0 : 1;
    tail[0]!.position.set(lerp(-0.15, -0.1, curl), lerp(0.02, -0.01, curl), 0);
    for (let i = 0; i < tail.length; i++) {
      const seg = tail[i]!;
      const wave = Math.sin(clock * (2 + 3 * walk) - i * 0.9) * (0.18 + 0.2 * walk) * swish;
      const lead = i === 0;
      seg.rotation.z = lead
        ? -(0.9 + 0.4 * run) * walk * (1 - curl) + 0.55 * upright
        : -0.18 * walk * (1 - curl) + (cat.alert > 0 ? Math.sin(clock * 14) * 0.15 * swish : 0);
      seg.rotation.y = wave * (1 - curl) + curl * (lead ? 0.9 : 0.8);
    }
    const puff = 1 + (cat.mode === "hop" || cat.mode === "run" ? 0.35 : 0);
    for (const seg of tail) seg.scale.set(1, puff, puff);
  }

  private material(color: string): THREE.MeshStandardMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
      this.materials.set(color, m);
    }
    return m;
  }

  private part(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    color: string,
    at: [number, number, number],
    scale: [number, number, number],
    shadow = false,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.material(color));
    mesh.position.set(...at);
    mesh.scale.set(...scale);
    mesh.castShadow = shadow;
    parent.add(mesh);
    return mesh;
  }

  private build(coat: Coat): Cat {
    const { sphere, cone, cylinder } = this.geometry;
    const root = new THREE.Group();
    root.scale.setScalar(SCALE);
    const rig = new THREE.Group();
    root.add(rig);

    const body = this.part(rig, sphere, coat.fur, [0, 0, 0], [0.17, 0.082, 0.085], true);
    if (coat.marks === "stripes") {
      for (const u of [-0.5, -0.1, 0.3]) this.part(body, sphere, coat.mark, [u, 0.8, 0], [0.1, 0.32, 1.02]);
    } else if (coat.marks === "patches") {
      this.part(body, sphere, coat.mark, [0.25, 0.7, 0.35], [0.5, 0.45, 0.42]);
      this.part(body, sphere, "#2a2632", [-0.4, 0.68, -0.4], [0.55, 0.42, 0.45]);
    }

    const head = new THREE.Group();
    rig.add(head);
    this.part(head, sphere, coat.fur, [0, 0, 0], [0.07, 0.062, 0.07], true);
    if (coat.marks === "patches") this.part(head, sphere, coat.mark, [-0.01, 0.025, 0.04], [0.04, 0.04, 0.035]);
    for (const z of [-1, 1]) {
      const ear = this.part(
        head,
        cone,
        coat.marks === "patches" && z > 0 ? "#2a2632" : coat.fur,
        [-0.005, 0.062, z * 0.04],
        [0.03, 0.055, 0.03],
      );
      ear.rotation.x = z * 0.2;
      this.part(head, sphere, coat.eyes, [0.058, 0.014, z * 0.03], [0.012, 0.014, 0.012]);
    }
    this.part(head, sphere, "#e89aa0", [0.07, -0.004, 0], [0.013, 0.01, 0.015]);

    const legs: THREE.Group[] = [];
    for (const [x, z] of [
      [0.1, 0.05],
      [0.1, -0.05],
      [-0.1, 0.055],
      [-0.1, -0.055],
    ] as const) {
      const leg = new THREE.Group();
      leg.position.set(x, -0.05, z);
      this.part(leg, cylinder, coat.marks === "patches" ? "#f4efe4" : coat.fur, [0, -0.035, 0], [0.022, 0.07, 0.022]);
      rig.add(leg);
      legs.push(leg);
    }

    const tail: THREE.Group[] = [];
    let parent: THREE.Object3D = rig;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      seg.position.set(i === 0 ? -0.15 : -0.085, i === 0 ? 0.02 : 0, 0);
      const tip = coat.marks !== "none" && i > 0 ? coat.mark : coat.fur;
      const bar = this.part(seg, cylinder, tip, [-0.0425, 0, 0], [0.017, 0.092, 0.017]);
      bar.rotation.z = Math.PI / 2;
      parent.add(seg);
      tail.push(seg);
      parent = seg;
    }

    return {
      x: 0,
      z: 0,
      heading: 0,
      mode: "sit",
      timer: 0,
      targetX: 0,
      targetZ: 0,
      speed: 0,
      timeout: 0,
      alert: 0,
      leap: null,
      visit: null,
      onRing: false,
      clock: this.random() * 10,
      phase: 0,
      walk: 0,
      sit: 1,
      curl: 0,
      groom: 0,
      root,
      rig,
      body,
      head,
      tail,
      legs,
    };
  }
}
