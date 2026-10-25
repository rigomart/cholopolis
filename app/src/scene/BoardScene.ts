import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  clamp,
  DICE_DRAG_EXPIRE_MS,
  DICE_DRAG_INTERVAL_MS,
  DICE_GRAB_LIMIT,
  DICE_HOLD_MAX_MS,
  type DiceDrag,
  type DiceToss,
} from "../../../shared/dice.ts";
import { HOTEL, PLAYER_COLORS, type PublicState } from "../../../shared/game.ts";
import { playLanding, startRattle } from "../audio.ts";
import { drawBoard, FONT, INK } from "./boardTexture.ts";
import { buildDie, DIE, FACE_UP } from "./dice.ts";
import { automaticToss, DICE_HELD_Y, DICE_OFFSETS, DICE_STEP, type DiceThrow, simulateThrow } from "./diceMotion.ts";
import {
  BOARD_SIZE,
  buildingSpot,
  HALF,
  isCorner,
  type Local,
  pieceSpot,
  sideOf,
  squareAt,
  toBoard,
} from "./layout.ts";
import { buildPiece } from "./pieces.ts";
import { registerThumbnails } from "./thumbnails.ts";

const THICKNESS = 0.35;
const TOP = THICKNESS;
const DICE_SPOTS: [Local, Local] = [
  { x: -3.4, z: 2.8 },
  { x: -2.5, z: 3.5 },
];
const CAMERA_DIRECTION = new THREE.Vector3(0, 15.5, 13.5).normalize();
/** Aim below the centre so the board sits above the action dock. */
const HOME_TARGET = new THREE.Vector3(0, 0, 1.7);
const CAMERA_DISTANCE = 21;
const THUMB_SIZE = 160;

interface Hop {
  to: THREE.Vector3;
  ms: number;
  height: number;
}

interface PieceView {
  key: string;
  mesh: THREE.Group;
  queue: Hop[];
  hop: (Hop & { from: THREE.Vector3; start: number }) | null;
  /** The piece waits for the dice to land before it walks. */
  waitUntil: number;
  heading: number;
  restHeading: number;
  restScale: number;
}

interface DieView {
  mesh: THREE.Group;
  halo: THREE.Mesh;
  rest: THREE.Vector3;
  final: THREE.Quaternion;
}

interface DiceInput {
  onDrag: (drag: DiceDrag | null) => void;
  onRoll: (toss: DiceToss) => void;
}

interface Grab {
  pointerId: number;
  offset: Local;
  samples: { point: Local; at: number }[];
  started: number;
  relayed: number;
}

const vec = (p: Local, y = TOP) => new THREE.Vector3(p.x, y, p.z);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const wrap = (v: number) => ((v + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const pieceKey = (piece: number, color: number) => `${piece}:${color}`;

/** Heading (rotation about y) that points a model's +x along a board direction. */
const headingOf = (dx: number, dz: number) => Math.atan2(-dz, dx);

/** Pieces face the way play runs along their side of the board. */
function travelHeading(square: number): number {
  const dir = toBoard({ x: -1, z: 0 }, sideOf(square));
  return headingOf(dir.x, dir.z);
}

function crowdScale(count: number): number {
  return count > 4 ? 0.7 : count > 2 ? 0.85 : 1;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of [o.material].flat()) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
  });
}

/**
 * The 3D table: board, dice, pieces and buildings. It only mirrors game state; `update` is
 * called with every new state and works out what to animate from what changed.
 */
export class BoardScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private readonly controls: OrbitControls;
  private readonly board: THREE.Mesh;
  private readonly boardCanvas = document.createElement("canvas");
  private readonly boardTexture: THREE.CanvasTexture;
  private readonly ring: THREE.Mesh;
  private readonly dice: DieView[] = [];
  private readonly pieces = new Map<string, PieceView>();
  private readonly buildings = new Map<number, { key: string; group: THREE.Group }>();
  private readonly deeds = new Map<number, { key: string; group: THREE.Group }>();
  private readonly observer: ResizeObserver;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly container: HTMLElement;
  private thumbTarget: THREE.WebGLRenderTarget | null = null;

  private state: PublicState | null = null;
  private seenRoll = -1;
  private seenMove = 0;
  private throwStart = 0;
  private flight: DiceThrow | null = null;
  private impactIndex = 0;
  private diceInput: DiceInput | null = null;
  private diceEnabled = false;
  private grab: Grab | null = null;
  private held: DiceDrag | null = null;
  private heldUpdated = 0;
  private awaitingRoll = false;
  private stopRattle: (() => void) | null = null;
  private lastFrame = 0;
  private cameraTween: { from: THREE.Vector3; fromTarget: THREE.Vector3; start: number } | null = null;
  private pickHandler: ((square: number) => void) | null = null;
  private pointerDown: { x: number; y: number } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(INK);
    this.scene.fog = new THREE.Fog(INK, 32, 70);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 34;
    this.controls.maxPolarAngle = 1.25;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.zoomToCursor = true;
    this.controls.target.copy(HOME_TARGET);

    this.scene.add(new THREE.HemisphereLight("#fff3e0", "#3a2a80", 1.25));
    const sun = new THREE.DirectionalLight("#ffffff", 1.7);
    sun.position.set(7, 16, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const table = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: "#26185c", roughness: 0.95 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);

    const small = Math.min(innerWidth, innerHeight) < 700;
    const size = Math.min(this.renderer.capabilities.maxTextureSize, small ? 2048 : 4096);
    this.boardCanvas.width = this.boardCanvas.height = size;
    drawBoard(this.boardCanvas);
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTexture.colorSpace = THREE.SRGBColorSpace;
    this.boardTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    // The canvas is drawn before the web font may have arrived; redraw once it has.
    void document.fonts.load(`condensed 800 40px ${FONT}`).then(() => {
      drawBoard(this.boardCanvas);
      this.boardTexture.needsUpdate = true;
    });

    const edge = new THREE.MeshStandardMaterial({ color: "#3b2a8a", roughness: 0.6 });
    const face = new THREE.MeshStandardMaterial({ map: this.boardTexture, roughness: 0.8 });
    this.board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE, THICKNESS, BOARD_SIZE), [
      edge,
      edge,
      face,
      edge,
      edge,
      edge,
    ]);
    this.board.position.y = THICKNESS / 2;
    this.board.receiveShadow = true;
    this.scene.add(this.board);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({ color: "#ffe500" }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.createDice();
    registerThumbnails((piece, color) => this.renderThumbnail(piece, color));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => this.beginGrab(e), { capture: true });
    canvas.addEventListener("pointermove", (e) => this.moveGrab(e));
    canvas.addEventListener("pointerup", (e) => this.releaseGrab(e));
    canvas.addEventListener("pointercancel", () => this.cancelDice());
    canvas.addEventListener("lostpointercapture", (e) => {
      if (this.grab?.pointerId === e.pointerId) this.cancelDice();
    });
    canvas.addEventListener("pointerleave", () => {
      if (!this.grab) canvas.style.cursor = "";
    });
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  onPick(handler: ((square: number) => void) | null): void {
    this.pickHandler = handler;
  }

  dispose(): void {
    this.cancelDice();
    registerThumbnails(null);
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.controls.dispose();
    this.thumbTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  update(state: PublicState | null): void {
    const first = this.state === null;
    const previousTurn = this.state?.turn;
    const previousRoll = this.state?.rollId;
    // The lobby slowly circles the board; when play starts, glide back to the standard view.
    if (state?.phase === "playing" && this.state?.phase === "lobby") this.resetCamera();
    this.state = state;
    this.controls.autoRotate = !this.reducedMotion && (!state || state.phase !== "playing");
    if (!state) {
      this.cancelDice();
      return this.syncPieces(null, true);
    }

    if (state.dice && state.rollId !== this.seenRoll) {
      const animate = !first && this.seenRoll !== -1;
      this.clearHold();
      this.placeDice(state.dice, animate, state.toss ?? automaticToss(), state.rollId);
    } else if (
      state.turn?.playerId !== previousTurn?.playerId ||
      state.turn?.stage !== "roll" ||
      state.rollId !== previousRoll ||
      !state.players.find((p) => p.id === state.turn?.playerId)?.connected
    ) {
      this.cancelDice();
    }
    this.seenRoll = state.rollId;
    this.syncPieces(state, first);
    this.syncBuildings(state);
  }

  onDiceInput(input: DiceInput | null): void {
    if (!input) this.cancelDice();
    this.diceInput = input;
  }

  setDiceEnabled(enabled: boolean): void {
    this.diceEnabled = enabled;
    if (!enabled && this.grab) this.cancelDice();
    if (!enabled) this.renderer.domElement.style.cursor = "";
  }

  showDiceDrag(drag: DiceDrag | null): void {
    if (this.grab || this.awaitingRoll || this.throwStart) return;
    if (!drag) return this.cancelDice();
    this.holdDice(drag);
  }

  cancelDice(): void {
    const notify = Boolean(this.grab || this.awaitingRoll);
    this.clearHold();
    if (!this.throwStart)
      for (const die of this.dice) {
        die.mesh.position.copy(die.rest);
        die.mesh.quaternion.copy(die.final);
      }
    if (notify) this.diceInput?.onDrag(null);
  }

  private clearHold(): void {
    const pointerId = this.grab?.pointerId;
    this.grab = null;
    this.held = null;
    this.awaitingRoll = false;
    this.controls.enabled = true;
    this.stopRattle?.();
    this.stopRattle = null;
    const canvas = this.renderer.domElement;
    canvas.style.cursor = "";
    if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  private holdDice(drag: DiceDrag): void {
    this.held = structuredClone(drag);
    this.heldUpdated = performance.now();
    this.stopRattle ??= startRattle(() => this.held?.intensity ?? 0);
  }

  private createDice(): void {
    for (const [n, spot] of DICE_SPOTS.entries()) {
      const mesh = buildDie();
      const rest = vec(spot, TOP + DIE / 2);
      const final = FACE_UP[n ? 3 : 5]!.clone();
      mesh.position.copy(rest);
      mesh.quaternion.copy(final);
      this.scene.add(mesh);
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.46, 0.025, 6, 36),
        new THREE.MeshBasicMaterial({ color: "#ffe500", transparent: true, opacity: 0.65 }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.visible = false;
      this.scene.add(halo);
      this.dice.push({ mesh, halo, rest, final });
    }
  }

  private placeDice(values: [number, number], animate: boolean, toss: DiceToss, rollId: number): void {
    this.flight = simulateThrow(toss, values, rollId);
    this.impactIndex = 0;
    this.dice.forEach((die, n) => {
      const last = this.flight!.dice[n === 0 ? 0 : 1].at(-1)!;
      die.rest.copy(last.position);
      die.final.copy(last.rotation);
      if (!animate || this.reducedMotion) {
        die.mesh.position.copy(die.rest);
        die.mesh.quaternion.copy(die.final);
      }
    });
    this.throwStart = animate && !this.reducedMotion ? performance.now() : 0;
  }

  private animateDice(now: number, dt: number): void {
    for (const die of this.dice) {
      die.halo.visible = this.diceEnabled && !this.held && !this.throwStart;
      die.halo.position.set(die.mesh.position.x, TOP + 0.015, die.mesh.position.z);
    }
    const held = this.held;
    if (held) {
      if (
        (this.grab && now - this.grab.started > DICE_HOLD_MAX_MS) ||
        (!this.grab && !this.awaitingRoll && now - this.heldUpdated > DICE_DRAG_EXPIRE_MS)
      )
        return this.cancelDice();
      held.intensity *= Math.exp(-dt * 6);
      this.dice.forEach((die, n) => {
        const target = new THREE.Vector3(held.point.x, DICE_HELD_Y, held.point.z).add(DICE_OFFSETS[n]!);
        die.mesh.position.lerp(target, 1 - Math.exp(-dt * 24));
        die.mesh.quaternion.setFromEuler(new THREE.Euler(held.rotation.x + n * 0.3, held.rotation.y, held.rotation.z));
      });
      if (this.grab && now - this.grab.relayed >= DICE_DRAG_INTERVAL_MS) {
        this.grab.relayed = now;
        this.diceInput?.onDrag(structuredClone(held));
      }
      return;
    }
    const flight = this.flight;
    if (!this.throwStart || !flight) return;
    const seconds = Math.min(flight.duration, (now - this.throwStart) / 1000);
    const index = Math.floor(seconds / DICE_STEP);
    const alpha = seconds / DICE_STEP - index;
    this.dice.forEach((die, n) => {
      const frames = flight.dice[n === 0 ? 0 : 1];
      const a = frames[Math.min(index, frames.length - 1)]!;
      const b = frames[Math.min(index + 1, frames.length - 1)]!;
      die.mesh.position.lerpVectors(a.position, b.position, alpha);
      die.mesh.quaternion.slerpQuaternions(a.rotation, b.rotation, alpha);
    });
    while (this.impactIndex < flight.impacts.length && flight.impacts[this.impactIndex]!.at <= seconds) {
      const hit = flight.impacts[this.impactIndex++]!;
      if (seconds - hit.at < 0.1) playLanding(hit.strength);
    }
    if (seconds >= flight.duration) this.throwStart = 0;
  }

  private pointerRay(e: PointerEvent): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    return ray;
  }

  private handPoint(e: PointerEvent): Local | null {
    const point = this.pointerRay(e).ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -DICE_HELD_Y),
      new THREE.Vector3(),
    );
    return point ? { x: point.x, z: point.z } : null;
  }

  private overDice(e: PointerEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.dice.some((die) => {
      const point = die.mesh.position.clone().project(this.camera);
      const x = rect.left + ((point.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - point.y) * rect.height) / 2;
      return Math.hypot(e.clientX - x, e.clientY - y) <= (e.pointerType === "touch" ? 28 : 20);
    });
  }

  private beginGrab(e: PointerEvent): void {
    if (this.grab) {
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    this.pointerDown = { x: e.clientX, y: e.clientY };
    if (
      e.button !== 0 ||
      !e.isPrimary ||
      !this.diceEnabled ||
      !this.diceInput ||
      this.throwStart ||
      this.awaitingRoll ||
      !this.overDice(e)
    )
      return;
    const point = this.handPoint(e);
    if (!point) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.pointerDown = null;
    this.cameraTween = null;
    this.controls.enabled = false;
    const center = this.dice.reduce((sum, die) => sum.add(die.mesh.position), new THREE.Vector3()).multiplyScalar(0.5);
    const drag: DiceDrag = {
      point: { x: clamp(center.x, DICE_GRAB_LIMIT), z: clamp(center.z, DICE_GRAB_LIMIT) },
      rotation: { x: 0, y: 0, z: 0 },
      intensity: 0,
    };
    const now = performance.now();
    this.grab = {
      pointerId: e.pointerId,
      offset: { x: drag.point.x - point.x, z: drag.point.z - point.z },
      samples: [{ point: drag.point, at: now }],
      started: now,
      relayed: now,
    };
    this.holdDice(drag);
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
    this.diceInput.onDrag(drag);
  }

  private moveGrab(e: PointerEvent): void {
    const grab = this.grab;
    const held = this.held;
    if (!grab || !held) {
      this.renderer.domElement.style.cursor =
        this.diceEnabled && !this.throwStart && !this.awaitingRoll && this.overDice(e) ? "grab" : "";
      return;
    }
    if (e.pointerId !== grab.pointerId) return;
    e.preventDefault();
    const point = this.handPoint(e);
    if (!point) return;
    const next = {
      x: clamp(point.x + grab.offset.x, DICE_GRAB_LIMIT),
      z: clamp(point.z + grab.offset.z, DICE_GRAB_LIMIT),
    };
    const dx = next.x - held.point.x;
    const dz = next.z - held.point.z;
    const now = performance.now();
    const elapsed = Math.max(0.008, (now - (grab.samples.at(-1)?.at ?? now)) / 1000);
    held.rotation = {
      x: wrap(held.rotation.x + dz * 1.7),
      y: wrap(held.rotation.y + dx * 0.5),
      z: wrap(held.rotation.z - dx * 1.7),
    };
    held.intensity = Math.min(1, Math.hypot(dx, dz) / elapsed / 12);
    held.point = next;
    grab.samples.push({ point: next, at: now });
    grab.samples = grab.samples.filter((sample) => now - sample.at < 120);
    this.heldUpdated = now;
  }

  private releaseGrab(e: PointerEvent): void {
    const grab = this.grab;
    const held = this.held;
    if (!grab || !held) return this.pick(e);
    if (e.pointerId !== grab.pointerId) return;
    this.moveGrab(e);
    const now = performance.now();
    const first = grab.samples.find((sample) => now - sample.at <= 100) ?? grab.samples.at(-1)!;
    const elapsed = Math.max(0.016, (now - first.at) / 1000);
    const velocity = {
      x: clamp((held.point.x - first.point.x) / elapsed, 12),
      z: clamp((held.point.z - first.point.z) / elapsed, 12),
    };
    const toss: DiceToss = {
      point: { ...held.point },
      rotation: { ...held.rotation },
      velocity,
      spin: {
        x: velocity.z * 1.6 + held.intensity * 5,
        y: velocity.x * 0.6,
        z: -velocity.x * 1.6 - held.intensity * 4,
      },
    };
    this.grab = null;
    this.awaitingRoll = true;
    this.controls.enabled = true;
    this.stopRattle?.();
    this.stopRattle = null;
    const canvas = this.renderer.domElement;
    canvas.style.cursor = "";
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    this.diceInput?.onRoll(toss);
  }

  // ---------------------------------------------------------------- pieces

  private syncPieces(state: PublicState | null, snap: boolean): void {
    const players = state ? state.players.filter((p) => !p.bankrupt) : [];
    const keep = new Set(players.map((p) => p.id));
    for (const [id, view] of this.pieces) {
      const p = players.find((x) => x.id === id);
      if (keep.has(id) && p && view.key === pieceKey(p.piece, p.color)) continue;
      // Gone, or picked a different token in the lobby: rebuild it.
      this.scene.remove(view.mesh);
      disposeTree(view.mesh);
      this.pieces.delete(id);
    }

    const bySquare = new Map<number, string[]>();
    for (const p of players) bySquare.set(p.position, [...(bySquare.get(p.position) ?? []), p.id]);

    const walkAfter = this.throwStart ? this.throwStart + (this.flight?.duration ?? 0) * 1000 : 0;
    const newMoves = state && !snap ? state.moves.filter((m) => m.id > this.seenMove) : [];
    if (state) this.seenMove = Math.max(this.seenMove, ...state.moves.map((m) => m.id));

    for (const p of players) {
      const here = bySquare.get(p.position) ?? [p.id];
      const rest = vec(pieceSpot(p.position, here.indexOf(p.id), here.length));
      let view = this.pieces.get(p.id);
      if (!view) {
        view = this.createPiece(p.piece, p.color);
        view.mesh.position.copy(rest);
        view.heading = travelHeading(p.position);
        this.pieces.set(p.id, view);
      }
      view.restHeading = travelHeading(p.position);
      view.restScale = crowdScale(here.length);
      if (snap) {
        view.queue = [];
        view.hop = null;
        view.mesh.position.copy(rest);
        continue;
      }
      const hopMs = this.reducedMotion ? 60 : 190;
      for (const move of newMoves.filter((m) => m.playerId === p.id)) {
        view.waitUntil = Math.max(view.waitUntil, walkAfter);
        if (move.steps === null) {
          view.queue.push({ to: vec(pieceSpot(move.to, 0, 1)), ms: 700, height: 2.2 });
          continue;
        }
        const dir = Math.sign(move.steps);
        for (let s = 1; s <= Math.abs(move.steps); s++) {
          const square = (((move.from + s * dir) % 40) + 40) % 40;
          view.queue.push({ to: vec(pieceSpot(square, 0, 1)), ms: hopMs, height: 0.38 });
        }
      }
      const last = view.queue.at(-1)?.to ?? view.hop?.to ?? view.mesh.position;
      if (last.distanceTo(rest) > 0.01) view.queue.push({ to: rest, ms: 160, height: 0.12 });
    }
  }

  private createPiece(piece: number, color: number): PieceView {
    const mesh = buildPiece(piece, PLAYER_COLORS[color] ?? "#ffffff");
    this.scene.add(mesh);
    return {
      key: pieceKey(piece, color),
      mesh,
      queue: [],
      hop: null,
      waitUntil: 0,
      heading: 0,
      restHeading: 0,
      restScale: 1,
    };
  }

  private animatePieces(now: number, dt: number): void {
    const ease = Math.min(1, dt * 12);
    for (const view of this.pieces.values()) {
      if (!view.hop && view.queue.length > 0 && now >= view.waitUntil) {
        const next = view.queue.shift();
        if (next) view.hop = { ...next, from: view.mesh.position.clone(), start: now };
      }
      const hop = view.hop;
      let target = view.restHeading;
      if (hop) {
        const t = Math.min(1, (now - hop.start) / hop.ms);
        view.mesh.position.lerpVectors(hop.from, hop.to, t);
        view.mesh.position.y = TOP + Math.sin(t * Math.PI) * hop.height;
        const dx = hop.to.x - hop.from.x;
        const dz = hop.to.z - hop.from.z;
        if (Math.hypot(dx, dz) > 0.2 && hop.height < 1) target = headingOf(dx, dz);
        if (t >= 1) view.hop = null;
      }
      const fixed = view.mesh.userData.fixedHeading as number | null;
      if (fixed !== null) target = fixed;
      const turn = ((target - view.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      view.heading += turn * ease;
      view.mesh.rotation.y = view.heading;
      const scale = THREE.MathUtils.lerp(view.mesh.scale.x, view.restScale, ease);
      view.mesh.scale.setScalar(scale);
    }

    const current = this.state?.phase === "playing" ? this.pieces.get(this.state.turn?.playerId ?? "") : undefined;
    this.ring.visible = Boolean(current);
    if (current) {
      this.ring.position.set(current.mesh.position.x, TOP + 0.01, current.mesh.position.z);
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(now / 220) * 0.08;
      this.ring.scale.setScalar(pulse * current.mesh.scale.x);
    }
  }

  /** A transparent PNG of one token, for the player list and the piece picker. */
  private renderThumbnail(piece: number, color: number): string {
    this.thumbTarget ??= new THREE.WebGLRenderTarget(THUMB_SIZE, THUMB_SIZE, { colorSpace: THREE.SRGBColorSpace });
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#fff3e0", "#3a2a80", 1.6));
    const key = new THREE.DirectionalLight("#ffffff", 2);
    key.position.set(2, 3, 2);
    scene.add(key);
    const model = buildPiece(piece, PLAYER_COLORS[color] ?? "#ffffff");
    const fixed = model.userData.fixedHeading as number | null;
    model.rotation.y = fixed ?? -0.45;
    scene.add(model);
    // Frame the model by its size, so the tall llama fits as well as the squat cuy.
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3()).length();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    camera.position.copy(
      new THREE.Vector3(0.55, 0.5, 1.05)
        .normalize()
        .multiplyScalar(extent * 1.75)
        .add(center),
    );
    camera.lookAt(center);

    const previousTarget = this.renderer.getRenderTarget();
    const previousClear = this.renderer.getClearColor(new THREE.Color());
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this.thumbTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    const pixels = new Uint8Array(THUMB_SIZE * THUMB_SIZE * 4);
    this.renderer.readRenderTargetPixels(this.thumbTarget, 0, 0, THUMB_SIZE, THUMB_SIZE, pixels);
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousClear, previousAlpha);
    disposeTree(model);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = THUMB_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const image = ctx.createImageData(THUMB_SIZE, THUMB_SIZE);
    const row = THUMB_SIZE * 4;
    // WebGL reads bottom-up.
    for (let y = 0; y < THUMB_SIZE; y++) {
      image.data.set(pixels.subarray((THUMB_SIZE - 1 - y) * row, (THUMB_SIZE - y) * row), y * row);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }

  // ---------------------------------------------------------------- buildings and ownership

  private syncBuildings(state: PublicState): void {
    state.props.forEach((prop, index) => {
      if (!prop) return;
      const houses = prop.houses;
      this.replace(this.buildings, index, String(houses), () =>
        houses > 0 ? this.buildingGroup(index, houses) : null,
      );
      const owner = state.players.find((p) => p.id === prop.owner);
      const key = owner ? `${owner.color}:${prop.mortgaged}` : "";
      this.replace(this.deeds, index, key, () => (owner ? this.deedGroup(index, owner.color, prop.mortgaged) : null));
    });
  }

  private replace(
    map: Map<number, { key: string; group: THREE.Group }>,
    index: number,
    key: string,
    build: () => THREE.Group | null,
  ): void {
    const existing = map.get(index);
    if (existing?.key === key) return;
    if (existing) {
      this.scene.remove(existing.group);
      disposeTree(existing.group);
    }
    map.delete(index);
    const group = build();
    if (!group) return;
    this.scene.add(group);
    map.set(index, { key, group });
  }

  private buildingGroup(index: number, houses: number): THREE.Group {
    const group = new THREE.Group();
    const hotel = houses === HOTEL;
    const spots = hotel ? [4] : Array.from({ length: houses }, (_, n) => n);
    for (const n of spots) {
      const b = this.building(hotel);
      b.position.copy(vec(buildingSpot(index, n)));
      b.rotation.y = (-sideOf(index) * Math.PI) / 2;
      group.add(b);
    }
    return group;
  }

  private building(hotel: boolean): THREE.Group {
    const color = hotel ? "#e5322d" : "#16b455";
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const w = hotel ? 0.46 : 0.15;
    const h = hotel ? 0.2 : 0.12;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), material);
    body.position.y = h / 2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.1, 4), material);
    roof.rotation.y = Math.PI / 4;
    roof.scale.x = hotel ? 2.6 : 1;
    roof.position.y = h + 0.05;
    for (const m of [body, roof]) m.castShadow = true;
    const group = new THREE.Group();
    group.add(body, roof);
    return group;
  }

  /** The owner's color along the outer edge of a square, and a dark veil when it is mortgaged. */
  private deedGroup(index: number, color: number, mortgaged: boolean): THREE.Group {
    const group = new THREE.Group();
    const side = sideOf(index);
    const c = { x: 5 - (index % 10), z: HALF - 0.09 };
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.05, 0.1),
      new THREE.MeshStandardMaterial({ color: PLAYER_COLORS[color] ?? "#fff", roughness: 0.4 }),
    );
    strip.position.copy(vec(toBoard(c, side), TOP + 0.025));
    strip.rotation.y = (-side * Math.PI) / 2;
    strip.castShadow = true;
    group.add(strip);
    if (mortgaged && !isCorner(index)) {
      const veil = new THREE.Mesh(
        new THREE.PlaneGeometry(0.94, 1.94),
        new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.55 }),
      );
      veil.rotation.set(-Math.PI / 2, 0, (-side * Math.PI) / 2);
      veil.position.copy(vec(toBoard({ x: c.x, z: HALF - 1 }, side), TOP + 0.003));
      group.add(veil);
    }
    return group;
  }

  // ---------------------------------------------------------------- frame, resize, picking

  private frame(now: number): void {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.animateDice(now, dt);
    this.animatePieces(now, dt);
    this.animateCamera(now);
    if (!this.grab) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    this.cancelDice();
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.controls.maxDistance = Math.max(34, this.homePosition().distanceTo(HOME_TARGET) * 1.25);
    this.camera.position.copy(this.homePosition());
    this.camera.updateProjectionMatrix();
  }

  private homePosition(): THREE.Vector3 {
    // Portrait screens need to back off so the whole board fits across.
    const distance = CAMERA_DISTANCE * Math.max(1, 1.1 / this.camera.aspect);
    return CAMERA_DIRECTION.clone().multiplyScalar(distance).add(HOME_TARGET);
  }

  resetCamera(): void {
    // Moving the camera under held dice would yank them away from the pointer.
    if (this.grab) return;
    this.cameraTween = {
      from: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      start: performance.now(),
    };
  }

  private animateCamera(now: number): void {
    const tween = this.cameraTween;
    if (!tween) return;
    const t = this.reducedMotion ? 1 : Math.min(1, (now - tween.start) / 1200);
    const e = easeOut(t);
    // Swing around the board rather than cutting through it: interpolate on a sphere.
    const from = tween.from.clone().sub(tween.fromTarget);
    const to = this.homePosition().sub(HOME_TARGET);
    const radius = THREE.MathUtils.lerp(from.length(), to.length(), e);
    const direction = new THREE.Vector3().lerpVectors(from.normalize(), to.normalize(), e).normalize();
    this.controls.target.lerpVectors(tween.fromTarget, HOME_TARGET, e);
    this.camera.position.copy(direction.multiplyScalar(radius).add(this.controls.target));
    if (t >= 1) this.cameraTween = null;
  }

  private pick(e: PointerEvent): void {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || !this.pickHandler || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const hit = this.pointerRay(e).intersectObject(this.board)[0];
    if (!hit) return;
    const square = squareAt({ x: hit.point.x, z: hit.point.z });
    if (square !== null) this.pickHandler(square);
  }
}
