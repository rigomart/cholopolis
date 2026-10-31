import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  angleDelta,
  clampTarget,
  homeView,
  lerpView,
  loadFollow,
  maxDistance,
  MIN_DISTANCE,
  mayFollow,
  rotateTheta,
  saveFollow,
  snapTheta,
  topView,
  type View,
  type ViewName,
  walkLeavesView,
} from "./cameraViews.ts";
import { easeOut } from "./effects.ts";

const GLIDE_MS = 900;
const SNAP_MS = 380;
const FOLLOW_LINGER_MS = 700;
const MAX_POLAR = 1.25;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

interface Framing {
  name: ViewName | null;
  frame: (aspect: number) => View;
}

interface Glide {
  from: View;
  to: (aspect: number) => View;
  start: number;
  ms: number;
  ease: (t: number) => number;
}

interface Follow {
  walkingPawnAt: () => THREE.Vector3 | null;
  returnTo: View;
  stoppedAt: number | null;
}

/** Reads OrbitControls' private damping leftovers (_sphericalDelta, _panOffset); missing fields mean no momentum. */
function momentumOf(controls: OrbitControls): { turn?: THREE.Spherical; pan?: THREE.Vector3 } {
  const { _sphericalDelta: turn, _panOffset: pan } = controls as unknown as {
    _sphericalDelta?: THREE.Spherical;
    _panOffset?: THREE.Vector3;
  };
  return { turn, pan };
}

/**
 * The board camera: free orbit, pan and zoom from OrbitControls, plus named views it glides to,
 * snapping to a board side after a drag, and following a pawn that walks out of view.
 */
export class CameraRig {
  readonly controls: OrbitControls;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly reducedMotion: boolean;
  private glide: Glide | null = null;
  private follow: Follow | null = null;
  private framing: Framing | null = { name: "tablero", frame: (aspect) => homeView(aspect) };
  private touching = false;
  private touchedFrom: View | null = null;
  /** The view before a light touch: OrbitControls applies a tap's or wheel notch's nudge only on the next update. */
  private settleFrom: View | null = null;
  private following: boolean;
  /** Tells the HUD which named view is showing, or null after the player moved the camera. */
  onView: ((name: ViewName | null) => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, reducedMotion: boolean) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;
    this.following = loadFollow(globalThis.localStorage, innerWidth, innerHeight);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    // Pan along the board's plane, not the screen's.
    controls.screenSpacePanning = false;
    controls.minDistance = MIN_DISTANCE;
    controls.maxPolarAngle = MAX_POLAR;
    controls.autoRotateSpeed = 0.6;
    controls.zoomToCursor = true;
    controls.addEventListener("start", () => this.grabbed());
    controls.addEventListener("end", () => this.released());
    this.controls = controls;
    this.apply(homeView(camera.aspect));
  }

  dispose(): void {
    this.controls.dispose();
  }

  get name(): ViewName | null {
    return this.framing?.name ?? null;
  }

  get followPlay(): boolean {
    return this.following;
  }

  setFollowPlay(on: boolean): void {
    this.following = on;
    saveFollow(globalThis.localStorage, on);
    if (!on) this.follow = null;
  }

  view(): View {
    const target = this.controls.target;
    const offset = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    return { target: { x: target.x, z: target.z }, radius: offset.radius, phi: offset.phi, theta: offset.theta };
  }

  private apply(view: View): void {
    this.controls.target.set(view.target.x, 0, view.target.z);
    this.camera.position
      .setFromSpherical(new THREE.Spherical(view.radius, view.phi, view.theta))
      .add(this.controls.target);
    this.camera.lookAt(this.controls.target);
  }

  // ---------------------------------------------------------------- going places

  /** Glides to `framing`; it then stays framed for the screen until the player moves the camera. */
  go(framing: Framing, ms = GLIDE_MS): void {
    this.setFraming(framing);
    this.follow = null;
    this.glideTo(framing.frame, ms, easeInOut);
  }

  /** The standing view, from the side the player is reading the board from (or Salida's, for `fromSalida`). */
  home(fromSalida = false): void {
    const theta = fromSalida ? 0 : snapTheta(this.view().theta);
    this.go({ name: "tablero", frame: (aspect) => homeView(aspect, theta) });
  }

  top(): void {
    const theta = snapTheta(this.view().theta);
    this.go({ name: "arriba", frame: (aspect) => topView(aspect, theta) });
  }

  /** A quarter turn around the board, keeping what is framed. */
  rotate(dir: 1 | -1): void {
    this.follow = null;
    const theta = rotateTheta(this.destination().theta, dir);
    const framing = this.framing;
    if (framing?.name === "tablero" || framing?.name === "arriba") {
      const frame = framing.name === "tablero" ? homeView : topView;
      this.go({ name: framing.name, frame: (aspect) => frame(aspect, theta) }, SNAP_MS * 1.4);
      return;
    }
    const here = this.view();
    this.setFraming(null);
    this.glideTo(() => ({ ...here, theta }), SNAP_MS * 1.4, easeOut);
  }

  /** Steps the zoom in (1) or out (-1). */
  zoom(dir: 1 | -1): void {
    this.follow = null;
    const here = this.destination();
    const radius = THREE.MathUtils.clamp(
      here.radius * (dir > 0 ? 0.75 : 1 / 0.75),
      MIN_DISTANCE,
      this.controls.maxDistance,
    );
    this.setFraming(null);
    this.glideTo(() => ({ ...here, radius }), SNAP_MS, easeOut);
  }

  private glideTo(to: (aspect: number) => View, ms: number, ease: (t: number) => number): void {
    this.stopMomentum();
    this.glide = { from: this.view(), to, start: performance.now(), ms: this.reducedMotion ? 0 : ms, ease };
  }

  /** Where the camera is gliding to, or is: quick presses add up rather than restarting mid-glide. */
  private destination(): View {
    return this.glide?.to(this.camera.aspect) ?? this.view();
  }

  private stopMomentum(): void {
    const { turn, pan } = momentumOf(this.controls);
    turn?.set(0, 0, 0);
    pan?.set(0, 0, 0);
  }

  private setFraming(framing: Framing | null): void {
    const changed = framing?.name !== this.framing?.name;
    this.framing = framing;
    if (changed) this.onView?.(framing?.name ?? null);
  }

  /** Cuts any glide or follow short; a camera stopped this way shows no named view. */
  stop(): void {
    if (this.glide || this.follow) this.setFraming(null);
    this.glide = null;
    this.follow = null;
  }

  // ---------------------------------------------------------------- the player's hands

  private grabbed(): void {
    // A pinch re-reports a start when one of its fingers lifts: keep where the gesture began.
    this.touchedFrom ??= this.view();
    this.touching = true;
    this.stop();
  }

  private released(): void {
    this.touching = false;
    const before = this.touchedFrom;
    this.touchedFrom = null;
    const doubleTapGlide = this.glide !== null;
    if (this.controls.autoRotate || doubleTapGlide || !before) return;
    const here = this.view();
    const momentum = momentumOf(this.controls);
    // With damping, the controls coast on for exactly the leftover they hold.
    const spin = momentum.turn?.theta ?? 0;
    const theta = snapTheta(here.theta + spin);
    if (!moved(before, here, TAP_JITTER) && Math.abs(spin) < TAP_JITTER.theta) {
      this.settleFrom = before;
      return;
    }
    if (Math.abs(angleDelta(here.theta + spin, theta)) > 0.002) {
      const tilt = momentum.turn?.phi ?? 0;
      const pan = momentum.pan ?? new THREE.Vector3();
      const end: View = {
        target: clampTarget({ x: here.target.x + pan.x, z: here.target.z + pan.z }),
        radius: here.radius,
        phi: THREE.MathUtils.clamp(here.phi + tilt, 0, MAX_POLAR),
        theta,
      };
      this.setFraming(null);
      this.glideTo(() => end, SNAP_MS, easeOut);
      return;
    }
    this.setFraming(null);
  }

  // ---------------------------------------------------------------- following the play

  /**
   * A pawn starts walking through `squares` (board points). The camera follows it when that walk
   * leaves the middle of the screen, then goes back to where the player had it.
   */
  walk(squares: THREE.Vector3[], pawn: () => THREE.Vector3 | null, diceHeld: boolean): void {
    if (!this.mayMove(diceHeld) || this.glide || this.follow || this.controls.autoRotate) return;
    if (!walkLeavesView(squares.map((p) => p.clone().project(this.camera)))) return;
    this.stopMomentum();
    this.follow = { walkingPawnAt: pawn, returnTo: this.view(), stoppedAt: null };
  }

  private mayMove(diceHeld: boolean): boolean {
    return mayFollow({
      enabled: this.following,
      reducedMotion: this.reducedMotion,
      touching: this.touching,
      diceHeld,
    });
  }

  private animateFollow(now: number, dt: number, diceHeld: boolean): void {
    const follow = this.follow;
    if (!follow) return;
    if (!this.mayMove(diceHeld)) {
      this.follow = null;
      return;
    }
    const pawn = follow.walkingPawnAt();
    if (pawn) {
      follow.stoppedAt = null;
      const here = this.view();
      const goal = clampTarget({ x: pawn.x, z: pawn.z });
      const k = 1 - Math.exp(-dt * 5);
      here.target.x += (goal.x - here.target.x) * k;
      here.target.z += (goal.z - here.target.z) * k;
      this.apply(here);
      return;
    }
    follow.stoppedAt ??= now;
    if (now - follow.stoppedAt < FOLLOW_LINGER_MS) return;
    this.follow = null;
    const { returnTo } = follow;
    const framing = this.framing;
    this.glideTo(framing ? framing.frame : () => returnTo, GLIDE_MS, easeInOut);
  }

  // ---------------------------------------------------------------- every frame

  update(now: number, dt: number, diceHeld: boolean): void {
    const glide = this.glide;
    if (glide) {
      const t = glide.ms <= 0 ? 1 : Math.min(1, (now - glide.start) / glide.ms);
      this.apply(lerpView(glide.from, glide.to(this.camera.aspect), glide.ease(t)));
      if (t >= 1) this.glide = null;
      return;
    }
    if (this.follow) return this.animateFollow(now, dt, diceHeld);
    if (diceHeld) return;
    this.controls.update();
    this.keepOverBoard();
    if (this.settleFrom && !this.touching) {
      if (moved(this.settleFrom, this.view(), TAP_JITTER)) this.setFraming(null);
      this.settleFrom = null;
    }
  }

  private keepOverBoard(): void {
    const target = this.controls.target;
    const over = clampTarget({ x: target.x, z: target.z });
    const dx = over.x - target.x;
    const dz = over.z - target.z;
    if (dx === 0 && dz === 0) return;
    target.x += dx;
    target.z += dz;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
  }

  /** The screen changed shape: keep the player's view, only reframing a named one and the zoom limit. */
  resize(): void {
    const aspect = this.camera.aspect;
    this.controls.maxDistance = maxDistance(aspect);
    const here = this.view();
    if (this.controls.autoRotate) {
      this.apply({ ...here, radius: homeView(aspect).radius });
      return;
    }
    if (this.framing && !this.glide && !this.follow && !this.touching) {
      this.apply(this.framing.frame(aspect));
      return;
    }
    if (here.radius > this.controls.maxDistance) this.apply({ ...here, radius: this.controls.maxDistance });
  }
}

const TAP_JITTER = { target: 0.05, radius: 0.05, phi: 0.02, theta: 0.02 };

function moved(a: View, b: View, by: typeof TAP_JITTER): boolean {
  return (
    Math.hypot(a.target.x - b.target.x, a.target.z - b.target.z) > by.target ||
    Math.abs(a.radius - b.radius) > by.radius ||
    Math.abs(a.phi - b.phi) > by.phi ||
    Math.abs(angleDelta(a.theta, b.theta)) > by.theta
  );
}
