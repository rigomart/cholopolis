import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { DICE_WALL } from "../../../shared/dice.ts";
import type { PublicState } from "../../../shared/game.ts";
import { INK } from "./boardTexture.ts";
import { INNER, toBoard } from "./layout.ts";
import { COMBI } from "./palette.ts";

const MINUTE = 60_000;
/** Untimed games go round a full day in this long. */
export const DAY_MS = 40 * MINUTE;
const TIMED_FULL_NIGHT_AT_SHARE = 0.85;
const LOOP_DUSK_ENDS = 0.4;
const LOOP_DAWN_STARTS = 0.7;
const LOOP_DAWN_ENDS = 0.85;

/**
 * How far into the evening the table is: 0 afternoon (the lobby's look), 0.5 sunset, 1 night.
 * A timed game runs from afternoon to night over its length; an untimed one loops through a day
 * from `startedAt`, or from `firstSeen` (when this screen first saw it in play) for games that predate `startedAt`.
 */
export function duskAt(state: PublicState | null, now: number, firstSeen: number): number {
  if (!state || state.phase === "lobby") return 0;
  if (state.endsAt !== null && state.timeLimit !== null) {
    const length = state.timeLimit * MINUTE;
    const progress = (now - (state.endsAt - length)) / length;
    return THREE.MathUtils.clamp(progress / TIMED_FULL_NIGHT_AT_SHARE, 0, 1);
  }
  const start = state.startedAt ?? firstSeen;
  const q = ((((now - start) % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
  if (q < LOOP_DUSK_ENDS) return q / LOOP_DUSK_ENDS;
  if (q < LOOP_DAWN_STARTS) return 1;
  if (q < LOOP_DAWN_ENDS) return 1 - (q - LOOP_DAWN_STARTS) / (LOOP_DAWN_ENDS - LOOP_DAWN_STARTS);
  return 0;
}

export type Keys<T> = readonly [afternoon: T, sunset: T, night: T];

const SKY = {
  background: [INK, "#33163f", "#0c0a24"],
  hemiSky: ["#fff3e0", "#ffc596", "#a3aee6"],
  hemiGround: ["#4a4d5a", "#5a4650", "#262a40"],
  sunColor: ["#ffffff", "#ff9d5c", "#b4c2ff"],
} as const satisfies Record<string, Keys<string>>;
const HEMI_INTENSITY: Keys<number> = [1.25, 1.1, 0.75];
const SUN_INTENSITY: Keys<number> = [1.7, 1.35, 0.5];
/** The board face lights itself a little at night so names and prices stay readable. */
const FACE_GLOW: Keys<number> = [0, 0.14, 0.3];
const SUN_AT: Keys<THREE.Vector3> = [
  new THREE.Vector3(7, 16, 9),
  new THREE.Vector3(15, 6, 7),
  new THREE.Vector3(-5, 15, 9),
];

const MIST = new THREE.Color("#7d7f99");
const MIST_MIX = 0.3;
const LAMP = new THREE.Color("#ffd58a");
const LAMP_OFF = new THREE.Color("#8f88b8");

const scratchKey = { index: 0, fraction: 0 };
function locate(s: number): void {
  const x = THREE.MathUtils.clamp(s, 0, 1) * 2;
  scratchKey.index = Math.min(1, Math.floor(x));
  scratchKey.fraction = x - scratchKey.index;
}

function lerpKeys(keys: Keys<number>, s: number): number {
  locate(s);
  return THREE.MathUtils.lerp(keys[scratchKey.index] ?? 0, keys[scratchKey.index + 1] ?? 0, scratchKey.fraction);
}

export const colorKeys = (keys: Keys<string>): Keys<THREE.Color> => [
  new THREE.Color(keys[0]),
  new THREE.Color(keys[1]),
  new THREE.Color(keys[2]),
];

export function sampleColor(out: THREE.Color, keys: Keys<THREE.Color>, s: number): THREE.Color {
  locate(s);
  return out.lerpColors(keys[scratchKey.index] ?? out, keys[scratchKey.index + 1] ?? out, scratchKey.fraction);
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------- streetlights

const POLE_HEIGHT = 0.62;
const ARM = 0.2;
const LAMP_X_PER_RAIL_SIDE = [-1.5, 1.5];

interface Streetlights {
  group: THREE.Group;
  heads: THREE.MeshBasicMaterial;
  glow: THREE.PointsMaterial;
  pools: THREE.MeshBasicMaterial;
}

function buildStreetlights(surfaceY: number, texture: THREE.Texture): Streetlights {
  const railTop = surfaceY + 0.24;
  const railZ = (DICE_WALL + INNER) / 2;
  const lamps = [0, 1, 2, 3].flatMap((side) =>
    LAMP_X_PER_RAIL_SIDE.map((x) => {
      const foot = toBoard({ x, z: railZ }, side);
      const inward = toBoard({ x: 0, z: -1 }, side);
      return { side, foot, head: { x: foot.x + inward.x * ARM, z: foot.z + inward.z * ARM } };
    }),
  );
  const spots = lamps.map((l) => l.head);
  const headY = railTop + POLE_HEIGHT + 0.01;

  const group = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: COMBI.ink3, roughness: 0.5 });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.02, POLE_HEIGHT, 6), iron, lamps.length);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.018, ARM + 0.02), iron, lamps.length);
  const heads = new THREE.MeshBasicMaterial({ color: LAMP_OFF });
  const bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.02, 0.055), heads, lamps.length);
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  lamps.forEach((l, i) => {
    const q = new THREE.Quaternion().setFromAxisAngle(up, (l.side * Math.PI) / 2);
    poles.setMatrixAt(i, m.makeTranslation(l.foot.x, railTop + POLE_HEIGHT / 2, l.foot.z));
    arms.setMatrixAt(
      i,
      m.compose(new THREE.Vector3((l.foot.x + l.head.x) / 2, headY, (l.foot.z + l.head.z) / 2), q, one),
    );
    bulbs.setMatrixAt(i, m.compose(new THREE.Vector3(l.head.x, headY - 0.012, l.head.z), q, one));
  });
  for (const mesh of [poles, arms]) mesh.castShadow = true;

  const glow = new THREE.PointsMaterial({
    color: LAMP,
    map: texture,
    size: 0.55,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glowPoints = new THREE.Points(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        spots.flatMap((p) => [p.x, headY - 0.02, p.z]),
        3,
      ),
    ),
    glow,
  );

  const pools = new THREE.MeshBasicMaterial({
    color: LAMP,
    map: texture,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const poolGeometry = mergeGeometries(
    spots.map((p) => new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2).translate(p.x, surfaceY + 0.004, p.z)),
  );
  group.add(poles, arms, bulbs, glowPoints, new THREE.Mesh(poolGeometry, pools));
  return { group, heads, glow, pools };
}

// ---------------------------------------------------------------- garúa

const DROPS = 1400;
const RAIN_SPREAD = 10;
const RAIN_HEIGHT = 10;
const RAIN_FALL = 5.5;
const DROP_LENGTH = 0.24;
/** One full fall, so the shader clock can wrap here (kept small for GPU float precision) without a jump. */
const RAIN_PERIOD = RAIN_HEIGHT / RAIN_FALL;
const RAIN_FADE_S = 10;

interface RainUniforms {
  [name: string]: THREE.IUniform;
  time: THREE.IUniform<number>;
  scale: THREE.IUniform<number>;
  color: THREE.IUniform<THREE.Color>;
  opacity: THREE.IUniform<number>;
}

const rainVertex = /* glsl */ `
uniform float time;
uniform float scale;
varying float vSize;
varying float vNearFade;
void main() {
  vec3 p = position;
  p.y = mod(p.y - time * ${RAIN_FALL.toFixed(2)}, ${RAIN_HEIGHT.toFixed(1)});
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vSize = ${DROP_LENGTH.toFixed(2)} * scale / -mv.z;
  gl_PointSize = vSize;
  vNearFade = smoothstep(7.0, 12.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const rainFragment = /* glsl */ `
#define MIN_STREAK_PX 0.6
uniform vec3 color;
uniform float opacity;
varying float vSize;
varying float vNearFade;
void main() {
  vec2 uv = gl_PointCoord;
  float streakWidth = max(0.03, MIN_STREAK_PX / vSize);
  float alpha = 1.0 - smoothstep(streakWidth * 0.5, streakWidth, abs(uv.x - 0.5));
  alpha *= smoothstep(0.0, 0.9, uv.y) * vNearFade;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha * opacity);
}`;

function buildDrizzle(): { points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>; uniforms: RainUniforms } {
  const positions = new Float32Array(DROPS * 3);
  for (let i = 0; i < DROPS; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * RAIN_SPREAD;
    positions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_SPREAD;
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const uniforms: RainUniforms = {
    time: { value: 0 },
    scale: { value: 1 },
    color: { value: new THREE.Color("#d4dbec") },
    opacity: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: rainVertex,
    fragmentShader: rainFragment,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return { points, uniforms };
}

const inPlay = (state: PublicState | null) => state !== null && state.phase !== "lobby";

const within = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// ---------------------------------------------------------------- atmosphere

/** A sky that paints its own horizon and gradient from the time of day; the fog takes its horizon colour. */
export interface Sky {
  horizon: (dusk: number, rain: number, out: THREE.Color) => THREE.Color;
  update: (dusk: number, night: number, rain: number) => void;
}

export interface Lighting {
  sky?: Sky;
  hemisphere: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  boardFace: THREE.MeshStandardMaterial;
  /** Gets how dark it is, 0 day to 1 night, whenever it changes. */
  onNight: (night: number) => void;
  /** The camera distance the scene's fog distances were chosen for. */
  fogTunedAt: number;
}

/** Takes over the scene's background, fog, the given lights and the board face's emissive glow, and adds streetlights and drizzle. Cosmetic and local to this screen. */
export class Atmosphere {
  private readonly scene: THREE.Scene;
  private readonly lighting: Lighting;
  private readonly reducedMotion: boolean;
  private readonly texture = glowTexture();
  private readonly lamps: Streetlights;
  private readonly drizzle = buildDrizzle();
  private readonly fog: THREE.Fog;
  private readonly fogPastTarget: { near: number; far: number };
  private viewDistance = 0;
  private readonly background = new THREE.Color();
  private readonly keys = {
    background: colorKeys(SKY.background),
    hemiSky: colorKeys(SKY.hemiSky),
    hemiGround: colorKeys(SKY.hemiGround),
    sunColor: colorKeys(SKY.sunColor),
  };
  private readonly sunDistance: number;
  /** Hidden overrides for screenshots: `?cielo=0..1` fixes the time of day, `?garua=0|1` the drizzle. */
  private readonly forced: { dusk: number | null; rain: boolean | null };

  private state: PublicState | null = null;
  private firstSeen = 0;
  private now: () => number = Date.now;
  private dusk = 0;
  private duskTarget = 0;
  private snapDusk = true;
  private shown = -1;
  private night = 0;
  private rain = 0;
  private shownRain = -1;
  private raining = false;
  private nextWeather = 0;

  constructor(scene: THREE.Scene, lighting: Lighting, surfaceY: number, reducedMotion: boolean) {
    this.scene = scene;
    this.lighting = lighting;
    this.reducedMotion = reducedMotion;
    if (!(scene.fog instanceof THREE.Fog)) throw new Error("The atmosphere needs the scene's linear fog.");
    this.fog = scene.fog;
    this.fogPastTarget = { near: this.fog.near - lighting.fogTunedAt, far: this.fog.far - lighting.fogTunedAt };
    this.viewDistance = lighting.fogTunedAt;
    scene.background = this.background;
    this.sunDistance = lighting.sun.position.length();

    const face = lighting.boardFace;
    face.emissive.set("#ffffff");
    face.emissiveMap = face.map;
    face.emissiveIntensity = 0;

    this.lamps = buildStreetlights(surfaceY, this.texture);
    scene.add(this.lamps.group, this.drizzle.points);

    const params = new URLSearchParams(location.search);
    const cielo = params.get("cielo");
    const garua = params.get("garua");
    this.forced = {
      dusk: cielo === null || !Number.isFinite(Number(cielo)) ? null : THREE.MathUtils.clamp(Number(cielo), 0, 1),
      rain: garua === null ? null : garua === "1",
    };
  }

  sync(state: PublicState | null): void {
    const previous = this.state;
    this.state = state;
    if (!inPlay(state) || inPlay(previous)) return;
    this.firstSeen = this.now();
    const joinedMidway = previous?.phase !== "lobby";
    if (joinedMidway) this.snapDusk = true;
    this.duskTarget = duskAt(state, this.firstSeen, this.firstSeen);
    this.nextWeather = performance.now() + within(60, 150) * 1000;
  }

  /** The server's clock, which a timed game's `endsAt` is measured on. */
  setClock(now: () => number): void {
    this.now = now;
  }

  /** `height` is the drawing buffer's height in pixels. */
  resize(height: number, camera: THREE.PerspectiveCamera): void {
    this.drizzle.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  /** `viewDistance` is how far the camera is from what it looks at. */
  update(now: number, dt: number, viewDistance: number): void {
    if (Math.abs(viewDistance - this.viewDistance) > 0.05) {
      this.viewDistance = viewDistance;
      this.applyBackgroundFogAndSun();
    }
    const state = this.state;
    const hourFrozen = state?.phase === "ended";
    if (!hourFrozen) this.duskTarget = this.forced.dusk ?? duskAt(state, this.now(), this.firstSeen);
    if (this.snapDusk) {
      this.dusk = this.duskTarget;
      this.snapDusk = false;
    } else {
      this.dusk += (this.duskTarget - this.dusk) * Math.min(1, dt / 4);
    }
    if (Math.abs(this.dusk - this.shown) > 0.0005) this.applySky(this.dusk);

    this.updateWeather(now, dt);
  }

  private applySky(s: number): void {
    this.shown = s;
    const { hemisphere, sun, boardFace, onNight } = this.lighting;
    const keys = this.keys;
    sampleColor(hemisphere.color, keys.hemiSky, s);
    sampleColor(hemisphere.groundColor, keys.hemiGround, s);
    hemisphere.intensity = lerpKeys(HEMI_INTENSITY, s);
    sampleColor(sun.color, keys.sunColor, s);
    locate(s);
    sun.position
      .lerpVectors(
        SUN_AT[scratchKey.index] ?? sun.position,
        SUN_AT[scratchKey.index + 1] ?? sun.position,
        scratchKey.fraction,
      )
      .setLength(this.sunDistance);
    boardFace.emissiveIntensity = lerpKeys(FACE_GLOW, s);

    const night = THREE.MathUtils.smoothstep(s, 0.45, 0.85);
    this.night = night;
    this.lamps.heads.color.lerpColors(LAMP_OFF, LAMP, night);
    this.lamps.glow.opacity = 0.85 * night;
    this.lamps.pools.opacity = 0.22 * night;
    this.lamps.glow.visible = this.lamps.pools.visible = night > 0.001;
    onNight(night);
    this.applyBackgroundFogAndSun();
  }

  private applyBackgroundFogAndSun(): void {
    const s = this.shown;
    const mist = this.rain * MIST_MIX;
    const sky = this.lighting.sky;
    if (sky) {
      sky.update(s, this.night, this.rain);
      sky.horizon(s, this.rain, this.background);
    } else {
      sampleColor(this.background, this.keys.background, s).lerp(MIST, mist);
    }
    this.fog.color.copy(this.background);
    this.fog.near = this.viewDistance + this.fogPastTarget.near - 10 * this.rain;
    this.fog.far = this.viewDistance + this.fogPastTarget.far - 12 * this.rain;
    this.lighting.sun.intensity = lerpKeys(SUN_INTENSITY, s) * (1 - 0.2 * this.rain);
  }

  private updateWeather(now: number, dt: number): void {
    const playing = this.state !== null && this.state.phase !== "lobby";
    if (playing && this.forced.rain === null && now >= this.nextWeather) {
      this.raining = !this.raining;
      this.nextWeather = now + (this.raining ? within(60, 150) : within(150, 330)) * 1000;
    }
    const target = this.forced.rain !== null ? Number(this.forced.rain) : playing && this.raining ? 1 : 0;
    const step = dt / RAIN_FADE_S;
    this.rain = target > this.rain ? Math.min(target, this.rain + step) : Math.max(target, this.rain - step);
    if (this.forced.rain !== null && this.shownRain < 0) this.rain = target;

    const { points: drops, uniforms } = this.drizzle;
    drops.visible = !this.reducedMotion && this.rain > 0.001;
    if (drops.visible) {
      uniforms.time.value = (now / 1000) % RAIN_PERIOD;
      uniforms.opacity.value = 0.35 * this.rain;
    }
    if (Math.abs(this.rain - this.shownRain) > 0.002) {
      this.shownRain = this.rain;
      this.applyBackgroundFogAndSun();
    }
  }

  dispose(): void {
    this.scene.remove(this.lamps.group, this.drizzle.points);
    this.lamps.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Points)) return;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
    this.drizzle.points.geometry.dispose();
    this.drizzle.points.material.dispose();
    this.texture.dispose();
  }
}
