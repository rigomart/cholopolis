import * as THREE from "three";

import { CHICHA, FONT, INK } from "./boardTexture.ts";

export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeIn = (t: number) => t ** 3;
/** Runs a little past 1 before settling, for things that pop into place. */
export const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/** Falls, bounces twice and settles: 0 is up, 1 is landed. */
export function bounce(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  const [offset, floor] = t < 2 / d ? [1.5, 0.75] : t < 2.5 / d ? [2.25, 0.9375] : [2.625, 0.984375];
  const x = t - offset / d;
  return n * x * x + floor;
}

export const BOUNCE_FIRST_HIT = 0.36;

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!o.geometry.userData.shared) o.geometry.dispose();
    for (const m of [o.material].flat()) {
      if (m.userData.shared) continue;
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
  });
}

/** Sets the opacity of every material under `root`; they must not be shared. */
export function fade(root: THREE.Object3D, opacity: number): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of [o.material].flat() as THREE.Material[]) {
      if (!m.transparent) {
        m.transparent = true;
        m.needsUpdate = true;
      }
      m.opacity = opacity;
    }
  });
}

/**
 * Something that plays over time. `step` gets progress from 0 to 1 every frame (0 while it waits
 * for `start`), and `done` runs once it reaches 1.
 */
export interface Tween {
  start: number;
  ms: number;
  step: (t: number) => void;
  done?: () => void;
  /** A newer tween on the same object takes over from this one wherever it got to. */
  target?: object;
}

const DUST = "#e6d8bb";

/**
 * Short-lived animations and particles on the board. Everything they create is disposed when
 * they end, and `finish` ends them all at once when the board has to show a state immediately.
 */
export class Effects {
  private readonly scene: THREE.Scene;
  private tweens: Tween[] = [];
  private dotTexture: THREE.CanvasTexture | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  add(tween: Tween): void {
    if (tween.target) this.tweens = this.tweens.filter((t) => t.target !== tween.target);
    this.tweens.push(tween);
  }

  update(now: number): void {
    const ended = this.tweens.filter((tween) => {
      const t = tween.ms > 0 ? THREE.MathUtils.clamp((now - tween.start) / tween.ms, 0, 1) : Number(now >= tween.start);
      tween.step(t);
      return t >= 1;
    });
    if (ended.length === 0) return;
    this.tweens = this.tweens.filter((tween) => !ended.includes(tween));
    for (const tween of ended) tween.done?.();
  }

  /** Jumps every tween to its end. */
  finish(): void {
    for (let tween = this.tweens.shift(); tween; tween = this.tweens.shift()) {
      tween.step(1);
      tween.done?.();
    }
  }

  dispose(): void {
    this.finish();
    this.dotTexture?.dispose();
    this.dotTexture = null;
  }

  /** A puff of dust around `at`, scaled by `spread`. */
  dust(at: THREE.Vector3, start: number, spread = 1): void {
    const count = 14;
    const flight = Array.from({ length: count }, (_, n) => ({
      angle: (n / count) * Math.PI * 2 + Math.random() * 0.4,
      reach: (0.14 + Math.random() * 0.14) * spread,
      lift: (0.05 + Math.random() * 0.1) * spread,
    }));
    const material = new THREE.PointsMaterial({ color: DUST, size: 0.07, map: this.dot(), transparent: true });
    material.depthWrite = false;
    this.particles(at, start, 650, count, material, (t, positions) => {
      const e = easeOut(t);
      flight.forEach(({ angle, reach, lift }, n) => {
        positions.setXYZ(
          n,
          Math.cos(angle) * (0.08 + reach * e),
          lift * Math.sin(e * Math.PI * 0.8),
          Math.sin(angle) * (0.08 + reach * e),
        );
      });
      material.size = (0.06 + 0.07 * e) * spread;
      material.opacity = 0.9 * (1 - t);
    });
  }

  sparkle(at: THREE.Vector3, start: number): void {
    const count = 40;
    const palette = [...CHICHA, "#ffffff"].map((c) => new THREE.Color(c));
    const colors = new Float32Array(count * 3);
    const flight = Array.from({ length: count }, (_, n) => {
      palette[n % palette.length]?.toArray(colors, n * 3);
      const angle = Math.random() * Math.PI * 2;
      const out = 0.4 + Math.random() * 1.1;
      return { x: Math.cos(angle) * out, z: Math.sin(angle) * out, y: 1.8 + Math.random() * 1.6 };
    });
    const material = new THREE.PointsMaterial({ size: 0.12, map: this.dot(), vertexColors: true, transparent: true });
    material.depthWrite = false;
    const gravity = 4.5;
    const ms = 1200;
    this.particles(
      at,
      start,
      ms,
      count,
      material,
      (t, positions) => {
        const s = (t * ms) / 1000;
        flight.forEach(({ x, y, z }, n) => {
          positions.setXYZ(n, x * s, Math.max(0, y * s - (gravity * s * s) / 2), z * s);
        });
        material.opacity = 1 - t ** 2;
      },
      colors,
    );
  }

  /** Text that pops up over `follow`, drifts upward (unless `still`) and fades: "+S/200". */
  floatText(text: string, follow: THREE.Object3D, start: number, still = false): void {
    const { texture, aspect } = textTexture(text);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity: 0 });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 10;
    sprite.visible = false;
    this.scene.add(sprite);
    const height = 0.42;
    this.add({
      start,
      ms: 1600,
      step: (t) => {
        sprite.visible = t > 0;
        const size = height * (still ? 1 : 0.6 + 0.4 * easeOutBack(Math.min(1, t * 4)));
        sprite.scale.set(size * aspect, size, 1);
        sprite.position.copy(follow.position);
        sprite.position.y += 0.8 + (still ? 0 : easeOut(t) * 0.7);
        material.opacity = Math.min(1, t * 8, (1 - t) * 4);
      },
      done: () => {
        this.scene.remove(sprite);
        texture.dispose();
        material.dispose();
      },
    });
  }

  private particles(
    at: THREE.Vector3,
    start: number,
    ms: number,
    count: number,
    material: THREE.PointsMaterial,
    step: (t: number, positions: THREE.BufferAttribute) => void,
    colors?: Float32Array,
  ): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    geometry.setAttribute("position", positions);
    if (colors) geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, material);
    points.position.copy(at);
    // The bounding sphere would be stale as soon as the particles move.
    points.frustumCulled = false;
    points.visible = false;
    this.scene.add(points);
    this.add({
      start,
      ms,
      step: (t) => {
        points.visible = t > 0;
        step(t, positions);
        positions.needsUpdate = true;
      },
      done: () => {
        this.scene.remove(points);
        geometry.dispose();
        material.dispose();
      },
    });
  }

  private dot(): THREE.CanvasTexture {
    if (this.dotTexture) return this.dotTexture;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      glow.addColorStop(0, "#ffffff");
      glow.addColorStop(0.45, "rgba(255,255,255,0.85)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 64, 64);
    }
    this.dotTexture = new THREE.CanvasTexture(canvas);
    this.dotTexture.colorSpace = THREE.SRGBColorSpace;
    return this.dotTexture;
  }
}

function textTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const px = 96;
  const font = `condensed 800 ${px}px ${FONT}`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.font = font;
  const pad = px * 0.2;
  canvas.width = Math.ceil((ctx?.measureText(text).width ?? px * text.length * 0.5) + pad * 2);
  canvas.height = Math.ceil(px * 1.25);
  if (ctx) {
    // Resizing the canvas resets its state.
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const y = canvas.height / 2;
    const top = y - px * 0.38;
    const bands = ctx.createLinearGradient(0, top, 0, top + px * 0.76);
    CHICHA.forEach((color, n) => {
      bands.addColorStop(n / CHICHA.length, color);
      bands.addColorStop((n + 1) / CHICHA.length - 0.001, color);
    });
    ctx.lineJoin = "round";
    ctx.lineWidth = px * 0.14;
    ctx.strokeStyle = INK;
    ctx.strokeText(text, canvas.width / 2, y);
    ctx.fillStyle = bands;
    ctx.fillText(text, canvas.width / 2, y);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}
