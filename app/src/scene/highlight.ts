import * as THREE from "three";

import { disposeTree, easeOut } from "./effects.ts";
import { squareBounds } from "./layout.ts";

const COLOR = "#ffc61a";
const LINE = 0.07;
const GLOW = [
  { reach: 0.1, opacity: 0.3 },
  { reach: 0.2, opacity: 0.18 },
  { reach: 0.32, opacity: 0.1 },
];
const PULSE_MS = 700;

interface Outline {
  root: THREE.Group;
  layers: { material: THREE.MeshBasicMaterial; opacity: number }[];
  start: number;
}

function rect(w: number, d: number): THREE.Path {
  const path = new THREE.Path();
  path.moveTo(-w / 2, -d / 2);
  path.lineTo(w / 2, -d / 2);
  path.lineTo(w / 2, d / 2);
  path.lineTo(-w / 2, d / 2);
  path.closePath();
  return path;
}

function frame(outerWidth: number, outerDepth: number, thickness: number): THREE.ShapeGeometry {
  const outer = new THREE.Shape(rect(outerWidth, outerDepth).getPoints());
  outer.holes.push(rect(outerWidth - 2 * thickness, outerDepth - 2 * thickness));
  return new THREE.ShapeGeometry(outer);
}

/** Glowing outlines over board squares, merged across sources; a new outline pulses once. */
export class SquareHighlight {
  private readonly outlines = new Map<number, Outline>();
  private readonly sources = new Map<string, readonly number[]>();
  private readonly scene: THREE.Scene;
  private readonly top: number;
  private readonly reducedMotion: boolean;

  constructor(scene: THREE.Scene, top: number, reducedMotion: boolean) {
    this.scene = scene;
    this.top = top;
    this.reducedMotion = reducedMotion;
  }

  /** Sets the squares `source` wants outlined; the board shows what every source wants. */
  set(source: string, indices: readonly number[]): void {
    this.sources.set(source, indices);
    const wanted = new Set([...this.sources.values()].flat());
    for (const [index, outline] of this.outlines) {
      if (wanted.has(index)) continue;
      this.scene.remove(outline.root);
      disposeTree(outline.root);
      this.outlines.delete(index);
    }
    for (const index of wanted) if (!this.outlines.has(index)) this.outlines.set(index, this.build(index));
  }

  update(now: number): void {
    for (const outline of this.outlines.values()) {
      if (!outline.start) outline.start = now;
      const t = this.reducedMotion ? 1 : Math.min(1, (now - outline.start) / PULSE_MS);
      const settle = easeOut(t);
      const scale = 1 + 0.18 * (1 - settle);
      outline.root.scale.set(scale, 1, scale);
      const breath = this.reducedMotion ? 1 : 0.85 + 0.15 * Math.cos((now - outline.start) / 260);
      const flash = 1 + 0.8 * (1 - settle);
      for (const layer of outline.layers) layer.material.opacity = Math.min(1, layer.opacity * flash * breath);
    }
  }

  dispose(): void {
    this.sources.clear();
    this.set("", []);
  }

  private build(index: number): Outline {
    const b = squareBounds(index);
    const root = new THREE.Group();
    root.position.set(b.x, this.top + 0.012, b.z);
    const layers: Outline["layers"] = [];
    const add = (geometry: THREE.BufferGeometry, opacity: number, additive: boolean) => {
      const material = new THREE.MeshBasicMaterial({
        color: COLOR,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      root.add(mesh);
      layers.push({ material, opacity });
    };
    const fill = new THREE.PlaneGeometry(b.width, b.depth);
    add(fill, 0.14, false);
    add(frame(b.width - 0.04, b.depth - 0.04, LINE), 1, false);
    for (const glow of GLOW) {
      add(frame(b.width + 2 * glow.reach, b.depth + 2 * glow.reach, glow.reach), glow.opacity, true);
    }
    this.scene.add(root);
    return { root, layers, start: 0 };
  }
}
