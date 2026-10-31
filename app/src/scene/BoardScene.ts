import * as THREE from "three";

import { SALIDA_BONUS } from "../../../shared/board.ts";
import { DICE_WALL, type DiceHold } from "../../../shared/dice.ts";
import { money, PLAYER_COLORS, type PublicState } from "../../../shared/game.ts";
import { playMeow } from "../audio.ts";
import { Atmosphere } from "./atmosphere.ts";
import { CHICHA, drawBoard, FONT, INK } from "./boardTexture.ts";
import { CameraRig } from "./CameraRig.ts";
import { FOV, HOME_DISTANCE, spotView, type ViewName } from "./cameraViews.ts";
import { Cats } from "./cats.ts";
import { type DiceInput, DiceRig } from "./DiceRig.ts";
import { disposeTree, easeIn, easeOut, Effects, fade } from "./effects.ts";
import { Estates, setWindowGlow } from "./estates.ts";
import { SquareHighlight } from "./highlight.ts";
import { BOARD_SIZE, INNER, type Local, pieceSpot, sideOf, squareAt, squareCenter, toBoard } from "./layout.ts";
import { buildPiece } from "./pieces.ts";
import { snapshotScene } from "./snapshot.ts";
import { registerThumbnails } from "./thumbnails.ts";

const THICKNESS = 0.35;
const TOP = THICKNESS;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;
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

const PIECE_LABEL_HEIGHT = 0.95;

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
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  private readonly rig: CameraRig;
  private readonly board: THREE.Mesh;
  private readonly boardCanvas = document.createElement("canvas");
  private readonly boardTexture: THREE.CanvasTexture;
  private readonly ring: THREE.Mesh;
  private readonly dice: DiceRig;
  private readonly cats: Cats;
  private readonly pieces = new Map<string, PieceView>();
  private readonly effects = new Effects(this.scene);
  private readonly estates = new Estates(this.scene, this.effects, TOP);
  private readonly atmosphere: Atmosphere;
  private readonly highlight: SquareHighlight;
  private readonly observer: ResizeObserver;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly container: HTMLElement;
  private thumbTarget: THREE.WebGLRenderTarget | null = null;

  private state: PublicState | null = null;
  private snapNext = false;
  private seenMove = 0;
  private lastFrame = 0;
  private pickHandler: ((square: number) => void) | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private lastTap: { at: number; x: number; y: number } | null = null;
  private pendingPick: ReturnType<typeof setTimeout> | undefined;
  private diceFinger: { id: number; x: number; y: number } | null = null;
  private replaying = false;
  private walksAwaitingDice: { view: PieceView; squares: THREE.Vector3[] }[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(INK);
    this.scene.fog = new THREE.Fog(INK, 32, 70);

    this.rig = new CameraRig(this.camera, this.renderer.domElement, this.reducedMotion);

    const hemisphere = new THREE.HemisphereLight("#fff3e0", "#3a2a80", 1.25);
    this.scene.add(hemisphere);
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
    this.atmosphere = new Atmosphere(
      this.scene,
      { hemisphere, sun, boardFace: face, onNight: setWindowGlow, fogTunedAt: HOME_DISTANCE },
      TOP,
      this.reducedMotion,
    );

    this.highlight = new SquareHighlight(this.scene, TOP, this.reducedMotion);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({ color: "#ffe500" }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.dice = new DiceRig(this.scene, this.camera, this.renderer.domElement, this.rig.controls);
    this.cats = new Cats(this.scene, {
      reducedMotion: this.reducedMotion,
      occupied: (square) => Boolean(this.state?.players.some((p) => !p.bankrupt && p.position === square)),
    });
    this.dice.onImpact = (strength) => this.cats.scatter(this.dice.positions, strength);
    registerThumbnails((piece, color) => this.renderThumbnail(piece, color));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();

    const canvas = this.renderer.domElement;
    // Capture phase, so a pointer that picks up the dice never reaches the orbit controls.
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (this.replaying) return;
        if (!e.isPrimary && this.diceFinger && this.dice.held) return this.handDiceToCamera();
        this.pointerDown = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
        if (!this.dice.pointerDown(e)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.pointerType === "touch") this.diceFinger = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.pointerDown = null;
        this.rig.stop();
      },
      { capture: true },
    );
    canvas.addEventListener("pointermove", (e) => {
      if (this.diceFinger?.id === e.pointerId) Object.assign(this.diceFinger, { x: e.clientX, y: e.clientY });
      this.dice.pointerMove(e);
    });
    canvas.addEventListener("pointerup", (e) => {
      if (this.diceFinger?.id === e.pointerId) this.diceFinger = null;
      if (!this.dice.pointerUp(e)) this.pick(e);
    });
    canvas.addEventListener("pointercancel", () => {
      if (this.dice.held) this.dice.cancel();
    });
    canvas.addEventListener("lostpointercapture", () => {
      if (this.dice.held) this.dice.cancel();
    });
    canvas.addEventListener("pointerleave", () => {
      if (!this.dice.held) canvas.style.cursor = "";
    });
    addEventListener("keydown", this.onKey);
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  /** OrbitControls only tracks pointers it saw go down, so the dice finger is replayed to it as a fresh touch. */
  private handDiceToCamera(): void {
    const finger = this.diceFinger;
    this.diceFinger = null;
    this.pointerDown = null;
    this.dice.cancel();
    if (!finger) return;
    this.replaying = true;
    try {
      this.renderer.domElement.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: finger.id,
          pointerType: "touch",
          isPrimary: true,
          clientX: finger.x,
          clientY: finger.y,
          button: 0,
          buttons: 1,
          bubbles: true,
        }),
      );
    } finally {
      this.replaying = false;
    }
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.state?.phase !== "playing" || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
    if (typing || this.dice.held) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.rotateCamera(-1),
      ArrowRight: () => this.rotateCamera(1),
      "+": () => this.zoomCamera(1),
      "=": () => this.zoomCamera(1),
      "-": () => this.zoomCamera(-1),
      "0": () => this.showView("tablero"),
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  onPick(handler: ((square: number) => void) | null): void {
    this.pickHandler = handler;
  }

  /**
   * Outlines squares on the board for `source`, replacing what that source outlined before; []
   * clears it. Each source (the deal table, an offer) keeps its own outline.
   */
  highlightSquares(indices: readonly number[], source = ""): void {
    this.highlight.set(source, indices);
  }

  dispose(): void {
    this.dice.cancel();
    this.highlight.dispose();
    registerThumbnails(null);
    this.renderer.setAnimationLoop(null);
    removeEventListener("keydown", this.onKey);
    clearTimeout(this.pendingPick);
    this.observer.disconnect();
    this.rig.dispose();
    this.effects.dispose();
    this.cats.dispose();
    this.atmosphere.dispose();
    this.thumbTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  update(state: PublicState | null): void {
    const previous = this.state;
    const previousTurn = this.state?.turn;
    const previousRoll = this.state?.rollId;
    // The lobby slowly circles the board; when play starts, glide back to the standard view.
    if (state?.phase === "playing" && this.state?.phase === "lobby" && !this.dice.held) this.rig.home(true);
    this.state = state;
    this.atmosphere.sync(state);
    this.rig.controls.autoRotate = !this.reducedMotion && (!state || state.phase !== "playing");
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

  /** The server's clock, so a timed game's light matches its countdown on every screen. */
  setClock(now: () => number): void {
    this.atmosphere.setClock(now);
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

  // ---------------------------------------------------------------- camera

  /** Runs with the named view on screen, or null once the player moved the camera off it. */
  onCameraView(handler: ((view: ViewName | null) => void) | null): void {
    this.rig.onView = handler;
    handler?.(this.rig.name);
  }

  /** "ficha" frames `playerId`'s pawn. */
  showView(view: ViewName, playerId?: string | null): void {
    // Moving the camera under held dice would yank them away from the pointer.
    if (this.dice.held) return;
    if (view === "tablero") this.rig.home();
    else if (view === "arriba") this.rig.top();
    else if (playerId) this.focusPlayer(playerId, "ficha");
  }

  /** Glides to a square, from outside its side so its name reads the right way up. */
  focusSquare(index: number): void {
    if (this.dice.held) return;
    const spot = squareCenter(index);
    this.rig.go({ name: null, frame: (aspect) => spotView(aspect, spot, index) });
  }

  /** `as` is the view reported to onCameraView while this framing holds. */
  focusPlayer(playerId: string, as: ViewName | null = null): void {
    const view = this.pieces.get(playerId);
    const player = this.state?.players.find((p) => p.id === playerId);
    if (this.dice.held || !view || !player) return;
    const spotWhenFocused = { x: view.mesh.position.x, z: view.mesh.position.z };
    this.rig.go({ name: as, frame: (aspect) => spotView(aspect, spotWhenFocused, player.position) });
  }

  /** A quarter turn of the board: 1 clockwise on screen, -1 the other way. */
  rotateCamera(dir: 1 | -1): void {
    if (!this.dice.held) this.rig.rotate(dir);
  }

  zoomCamera(dir: 1 | -1): void {
    if (!this.dice.held) this.rig.zoom(dir);
  }

  /** Whether the camera follows a pawn that walks out of view ("Seguir la jugada"); remembered on this device. */
  get followPlay(): boolean {
    return this.rig.followPlay;
  }

  setFollowPlay(on: boolean): void {
    this.rig.setFollowPlay(on);
  }

  // ---------------------------------------------------------------- pieces

  /** Where a player's piece is on screen (CSS pixels from the board's top left), or null when it is off screen or gone. */
  pieceScreenPosition(playerId: string): { x: number; y: number } | null {
    const view = this.pieces.get(playerId);
    if (!view || view.leaving) return null;
    const { clientWidth: w, clientHeight: h } = this.container;
    const p = view.mesh.position.clone();
    p.y += PIECE_LABEL_HEIGHT * view.mesh.scale.y;
    p.project(this.camera);
    if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) return null;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
  }

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

    this.walksAwaitingDice = this.walksAwaitingDice.filter((w) => [...this.pieces.values()].includes(w.view));
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
      const moves = newMoves.filter((m) => m.playerId === p.id);
      const walkFrom = view.queue.length;
      for (const move of moves) {
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
      if (moves.length > 0) this.walksAwaitingDice.push({ view, squares: view.queue.slice(walkFrom).map((h) => h.to) });
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

  /** The board as it stands, from a fixed camera, for the end-of-game postcard. */
  snapshot(width: number, height: number): HTMLCanvasElement {
    // A building still going up would show its scaffolding.
    this.effects.finish();
    return snapshotScene(
      this.renderer,
      this.scene,
      this.camera.position.distanceTo(this.rig.controls.target),
      width,
      height,
    );
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
    this.cats.update(dt, this.dice.positions);
    this.effects.update(now);
    this.followWalks(now);
    this.rig.update(now, dt, this.dice.held);
    this.highlight.update(now);
    this.atmosphere.update(now, dt, this.camera.position.distanceTo(this.rig.controls.target));
    this.renderer.render(this.scene, this.camera);
  }

  private followWalks(now: number): void {
    if (this.walksAwaitingDice.length === 0) return;
    const ready = this.walksAwaitingDice.filter((w) => now >= w.view.waitUntil);
    this.walksAwaitingDice = this.walksAwaitingDice.filter((w) => !ready.includes(w));
    for (const { view, squares } of ready) {
      const pawn = () => (view.hop || view.queue.length > 0 ? view.mesh.position : null);
      this.rig.walk(squares, pawn, this.dice.held);
    }
  }

  private resize(): void {
    // A throw already on its way keeps flying.
    if (this.dice.held) this.dice.cancel();
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.rig.resize();
    this.atmosphere.resize(h * this.renderer.getPixelRatio(), this.camera);
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
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const now = performance.now();
    const last = this.lastTap;
    const double =
      last !== null &&
      now - last.at < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_PX;
    this.lastTap = double ? null : { at: now, x: e.clientX, y: e.clientY };
    const ray = this.pointerRay(e);
    if (this.cats.poke(ray.ray)) playMeow();
    const hit = ray.intersectObject(this.board)[0];
    const square = hit ? squareAt({ x: hit.point.x, z: hit.point.z }) : null;
    clearTimeout(this.pendingPick);
    if (double && this.state?.phase === "playing") {
      if (square !== null) this.focusSquare(square);
      else this.showView("tablero");
      return;
    }
    if (square === null) return;
    const deedCoversBoard = e.pointerType === "touch" || matchMedia("(max-width: 900px)").matches;
    if (deedCoversBoard) this.pendingPick = setTimeout(() => this.pickHandler?.(square), DOUBLE_TAP_MS);
    else this.pickHandler?.(square);
  }
}
