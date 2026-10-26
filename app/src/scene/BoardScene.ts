import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { SALIDA_BONUS } from "../../../shared/board.ts";
import { DICE_WALL, type DiceHold } from "../../../shared/dice.ts";
import { money, PLAYER_COLORS, type PublicState } from "../../../shared/game.ts";
import { CHICHA, drawBoard, FONT, INK } from "./boardTexture.ts";
import { type DiceInput, DiceRig } from "./DiceRig.ts";
import { disposeTree, easeIn, easeOut, Effects, fade } from "./effects.ts";
import { Estates } from "./estates.ts";
import { BOARD_SIZE, INNER, type Local, pieceSpot, sideOf, squareAt, squareCenter, toBoard } from "./layout.ts";
import { buildPiece } from "./pieces.ts";
import { registerThumbnails } from "./thumbnails.ts";

const THICKNESS = 0.35;
const TOP = THICKNESS;
const CAMERA_DIRECTION = new THREE.Vector3(0, 15.5, 13.5).normalize();
/** Aim below the centre so the board sits above the action dock. */
const HOME_TARGET = new THREE.Vector3(0, 0, 1.7);
const CAMERA_DISTANCE = 21;
const THUMB_SIZE = 160;

interface Hop {
  to: THREE.Vector3;
  ms: number;
  height: number;
  onLand?: () => void;
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
  leaving: { start: number | null } | null;
}

const vec = (p: Local, y = TOP) => new THREE.Vector3(p.x, y, p.z);

/** The low rail the dice bounce off, between their walls and the squares, with a chicha post at each corner. */
function buildRim(): THREE.Group {
  const rim = new THREE.Group();
  const width = INNER - DICE_WALL;
  const height = 0.24;
  const rail = new THREE.MeshStandardMaterial({ color: "#3b2a8a", roughness: 0.55 });
  for (let side = 0; side < 4; side++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * DICE_WALL, height, width), rail);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.4, height + 0.06, width * 1.4),
      new THREE.MeshStandardMaterial({ color: CHICHA[side], roughness: 0.45 }),
    );
    const along = toBoard({ x: 0, z: DICE_WALL + width / 2 }, side);
    const corner = toBoard({ x: DICE_WALL + width / 2, z: DICE_WALL + width / 2 }, side);
    bar.position.set(along.x, TOP + height / 2, along.z);
    bar.rotation.y = (side * Math.PI) / 2;
    post.position.set(corner.x, TOP + (height + 0.06) / 2, corner.z);
    for (const m of [bar, post]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    rim.add(bar, post);
  }
  return rim;
}
const pieceKey = (piece: number, color: number) => `${piece}:${color}`;

/** Heading (rotation about y) that points a model's +x along a board direction. */
const headingOf = (dx: number, dz: number) => Math.atan2(-dz, dx);

/** Pieces face the way play runs along their side of the board. */
function travelHeading(square: number): number {
  const dir = toBoard({ x: -1, z: 0 }, sideOf(square));
  return headingOf(dir.x, dir.z);
}

function skipsAhead(previous: PublicState, next: PublicState): boolean {
  if (document.hidden || next.rollId > previous.rollId + 1) return true;
  const last = previous.log.at(-1)?.id;
  return last !== undefined && !next.log.some((e) => e.id === last);
}

function crowdScale(count: number): number {
  return count > 4 ? 0.7 : count > 2 ? 0.85 : 1;
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
  private readonly dice: DiceRig;
  private readonly pieces = new Map<string, PieceView>();
  private readonly effects = new Effects(this.scene);
  private readonly estates = new Estates(this.scene, this.effects, TOP);
  private readonly observer: ResizeObserver;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly container: HTMLElement;
  private thumbTarget: THREE.WebGLRenderTarget | null = null;

  private state: PublicState | null = null;
  private snapNext = false;
  private seenMove = 0;
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
    this.scene.add(buildRim());

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({ color: "#ffe500" }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.dice = new DiceRig(this.scene, this.camera, this.renderer.domElement, this.controls);
    registerThumbnails((piece, color) => this.renderThumbnail(piece, color));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();

    const canvas = this.renderer.domElement;
    // Capture phase, so a pointer that picks up the dice never reaches the orbit controls.
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        this.pointerDown = { x: e.clientX, y: e.clientY };
        if (!this.dice.pointerDown(e)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.pointerDown = null;
        this.cameraTween = null;
      },
      { capture: true },
    );
    canvas.addEventListener("pointermove", (e) => this.dice.pointerMove(e));
    canvas.addEventListener("pointerup", (e) => {
      if (!this.dice.pointerUp(e)) this.pick(e);
    });
    canvas.addEventListener("pointercancel", () => this.dice.cancel());
    canvas.addEventListener("lostpointercapture", () => {
      if (this.dice.held) this.dice.cancel();
    });
    canvas.addEventListener("pointerleave", () => {
      if (!this.dice.held) canvas.style.cursor = "";
    });
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  onPick(handler: ((square: number) => void) | null): void {
    this.pickHandler = handler;
  }

  dispose(): void {
    this.dice.cancel();
    registerThumbnails(null);
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.controls.dispose();
    this.effects.dispose();
    this.thumbTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  update(state: PublicState | null): void {
    const previous = this.state;
    const previousTurn = this.state?.turn;
    const previousRoll = this.state?.rollId;
    // The lobby slowly circles the board; when play starts, glide back to the standard view.
    if (state?.phase === "playing" && this.state?.phase === "lobby") this.resetCamera();
    this.state = state;
    this.controls.autoRotate = !this.reducedMotion && (!state || state.phase !== "playing");
    const snap = state !== null && (this.snapNext || !previous || skipsAhead(previous, state));
    this.dice.sync(state, snap);
    if (!state) return this.syncPieces(null, true);
    this.snapNext = false;
    if (
      state.turn?.playerId !== previousTurn?.playerId ||
      state.turn?.stage !== "roll" ||
      state.rollId !== previousRoll ||
      !state.players.find((p) => p.id === state.turn?.playerId)?.connected
    ) {
      this.dice.cancel();
    }
    if (snap) this.effects.finish();
    this.syncPieces(state, snap);
    this.estates.sync(state, !snap && !this.reducedMotion);
  }

  /** Makes the next `update` show its state as it is, without animating. */
  snapNextUpdate(): void {
    this.snapNext = true;
  }

  onDiceInput(input: DiceInput | null): void {
    this.dice.setInput(input);
  }

  setDiceEnabled(enabled: boolean): void {
    this.dice.setEnabled(enabled);
  }

  showDiceHold(hold: DiceHold | null): void {
    this.dice.showHold(hold);
  }

  cancelDice(): void {
    this.dice.cancel();
  }

  throwDice(): boolean {
    return this.dice.throwFromButton();
  }

  diceLanded(rollId: number): boolean {
    return this.dice.landed(rollId);
  }

  // ---------------------------------------------------------------- pieces

  private syncPieces(state: PublicState | null, snap: boolean): void {
    const players = state ? state.players.filter((p) => !p.bankrupt) : [];
    for (const [id, view] of this.pieces) {
      const p = players.find((x) => x.id === id);
      if (p && view.key === pieceKey(p.piece, p.color) && !view.leaving) continue;
      if (!p && !snap && state?.players.some((x) => x.id === id && x.bankrupt)) {
        view.leaving ??= { start: null };
        continue;
      }
      // Gone, or picked a different token in the lobby: rebuild it.
      this.removePiece(id, view);
    }

    const bySquare = new Map<number, string[]>();
    for (const p of players) bySquare.set(p.position, [...(bySquare.get(p.position) ?? []), p.id]);

    const walkAfter = this.dice.landsAt;
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
      const { mesh } = view;
      for (const move of newMoves.filter((m) => m.playerId === p.id)) {
        view.waitUntil = Math.max(view.waitUntil, walkAfter);
        if (move.steps === null) {
          view.queue.push({ to: vec(pieceSpot(move.to, 0, 1)), ms: 700, height: 2.2 });
          continue;
        }
        const dir = Math.sign(move.steps);
        for (let s = 1; s <= Math.abs(move.steps); s++) {
          const square = (((move.from + s * dir) % 40) + 40) % 40;
          const hop: Hop = { to: vec(pieceSpot(square, 0, 1)), ms: hopMs, height: 0.38 };
          // Walking forward onto or past Salida pays the salary, as `walk` in shared/game.ts does.
          if (square === 0 && dir > 0) hop.onLand = () => this.collectSalary(mesh);
          view.queue.push(hop);
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
      leaving: null,
    };
  }

  private removePiece(id: string, view: PieceView): void {
    this.scene.remove(view.mesh);
    disposeTree(view.mesh);
    this.pieces.delete(id);
  }

  private collectSalary(piece: THREE.Object3D): void {
    const now = performance.now();
    if (!this.reducedMotion) this.effects.sparkle(vec(squareCenter(0), TOP + 0.02), now);
    this.effects.floatText(`+${money(SALIDA_BONUS)}`, piece, now, this.reducedMotion);
  }

  private sinkPiece(id: string, view: PieceView, now: number): void {
    const leaving = view.leaving;
    if (!leaving || view.hop || view.queue.length > 0) return;
    leaving.start ??= Math.max(now, view.waitUntil);
    const ms = this.reducedMotion ? 250 : 900;
    const t = THREE.MathUtils.clamp((now - leaving.start) / ms, 0, 1);
    if (t <= 0) return;
    if (!this.reducedMotion) view.mesh.position.y = TOP - easeIn(t) * 0.6;
    fade(view.mesh, 1 - easeOut(t));
    if (t >= 1) this.removePiece(id, view);
  }

  private animatePieces(now: number, dt: number): void {
    const ease = Math.min(1, dt * 12);
    for (const [id, view] of this.pieces) {
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
        if (t >= 1) {
          view.hop = null;
          hop.onLand?.();
        }
      }
      const fixed = view.mesh.userData.fixedHeading as number | null;
      if (fixed !== null) target = fixed;
      const turn = ((target - view.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      view.heading += turn * ease;
      view.mesh.rotation.y = view.heading;
      const scale = THREE.MathUtils.lerp(view.mesh.scale.x, view.restScale, ease);
      view.mesh.scale.setScalar(scale);
      this.sinkPiece(id, view, now);
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

  // ---------------------------------------------------------------- frame, resize, picking

  private frame(now: number): void {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.dice.animate(now, dt);
    this.animatePieces(now, dt);
    this.effects.update(now);
    this.animateCamera(now);
    if (!this.dice.held) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    this.dice.cancel();
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
    if (this.dice.held) return;
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
