import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { colorKeys, type Keys, sampleColor } from "./atmosphere.ts";
import { part } from "./buildings.ts";
import { COMBI, STREET } from "./palette.ts";

const SKY_TOP: Keys<string> = ["#6f8aa8", "#2f2f5c", "#05060c"];
const SKY_MID: Keys<string> = ["#a9b9c6", "#b0587a", "#141830"];
const SKY_HORIZON: Keys<string> = ["#d9d3c4", "#ffb070", "#241f33"];
const MIST = new THREE.Color("#8d8fa6");
const keys = {
  top: colorKeys(SKY_TOP),
  mid: colorKeys(SKY_MID),
  horizon: colorKeys(SKY_HORIZON),
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CELLS = 4;
const TILE_W = 2.0;
const TILE_H = 2.8;

function tileTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Walls are white so each instance colour tints them; `glow` holds the panes lit at night. */
function facadeTextures(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const size = 256;
  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D | null] => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return [c, c.getContext("2d")];
  };
  const [dayCanvas, day] = make();
  const [glowCanvas, glow] = make();
  const rnd = mulberry32(11);
  if (day && glow) {
    day.fillStyle = "#ffffff";
    day.fillRect(0, 0, size, size);
    glow.fillStyle = "#000000";
    glow.fillRect(0, 0, size, size);
    const cell = size / CELLS;
    for (let gx = 0; gx < CELLS; gx++) {
      for (let gy = 0; gy < CELLS; gy++) {
        const x = gx * cell + cell * 0.18;
        const y = gy * cell + cell * 0.16;
        day.fillStyle = "#4b5668";
        day.fillRect(x, y, cell * 0.64, cell * 0.62);
        day.fillStyle = "#222a38";
        day.fillRect(x, y, cell * 0.64, cell * 0.12);
        if (rnd() < 0.5) {
          glow.fillStyle = rnd() < 0.3 ? "#fff0c4" : "#ffc96a";
          glow.fillRect(x, y, cell * 0.64, cell * 0.62);
        }
      }
    }
  }
  return { map: tileTexture(dayCanvas), glow: tileTexture(glowCanvas) };
}

/** BoxGeometry's +y and -y faces, which take one plain-wall texel instead of the tiled facade. */
const ROOF_FACES = new Set([2, 3]);
const PLAIN_WALL_UV = 0.008;

function tiledTower(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    if (ROOF_FACES.has(face)) {
      uv.setXY(i, PLAIN_WALL_UV, PLAIN_WALL_UV);
      continue;
    }
    const across = face < 2 ? d : w;
    uv.setXY(i, uv.getX(i) * (across / TILE_W), uv.getY(i) * (h / TILE_H));
  }
  return g;
}

const PAINT = "#a9a596";
const CENTRE_LINE = "#a88d3a";

/** Fractions of canvas height, from the bottom, covering the HUD's bottom dock and top player strip. */
export function hudFadeBands(width: number, height: number): { bottom: [number, number]; top: [number, number] } {
  return height > width ? { bottom: [0.2, 0.36], top: [0.74, 0.86] } : { bottom: [0.1, 0.24], top: [0.84, 0.94] };
}

const NO_HUD = { bottom: new THREE.Vector2(-1, -0.5), top: new THREE.Vector2(2, 3) };

interface HudFade {
  bottomFadedToShown: { value: THREE.Vector2 };
  topShownToFaded: { value: THREE.Vector2 };
  heightPx: { value: number };
}

function hudFadePaint(fade: HudFade): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    polygonOffset: true,
    polygonOffsetFactor: -2,
    transparent: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fade);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        "uniform vec2 bottomFadedToShown;\nuniform vec2 topShownToFaded;\nuniform float heightPx;\nvoid main() {",
      )
      .replace(
        "#include <opaque_fragment>",
        `float screenY = gl_FragCoord.y / heightPx;
        diffuseColor.a *= smoothstep(bottomFadedToShown.x, bottomFadedToShown.y, screenY)
          * (1.0 - smoothstep(topShownToFaded.x, topShownToFaded.y, screenY));
        #include <opaque_fragment>`,
      );
  };
  return material;
}
const FACADES = ["#d8c9a8", "#c2b49c", "#cfc8bc", "#b9c0c2", "#dcb89a", "#e9dfc7", "#a9a79f", COMBI.plate];
const HEIGHTS = [1.6, 2.6, 3.8, 5.6, 8.5, 13];

interface Lot {
  x: number;
  z: number;
  level: number;
  sx: number;
  sz: number;
  color: string;
}

/** Everything behind the board: sky dome, ground, and the avenues running on into the fog. */
export class Backdrop {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly facade = facadeTextures();
  private readonly facades: THREE.MeshLambertMaterial;
  private readonly lamps = new THREE.MeshBasicMaterial({ color: "#8f88b8" });
  private readonly hudFade: HudFade = {
    bottomFadedToShown: { value: NO_HUD.bottom.clone() },
    topShownToFaded: { value: NO_HUD.top.clone() },
    heightPx: { value: 1 },
  };
  private readonly disposables: { dispose: () => void }[] = [];
  private readonly colors = {
    top: new THREE.Color(),
    mid: new THREE.Color(),
    horizon: new THREE.Color(),
  };

  constructor() {
    this.facades = new THREE.MeshLambertMaterial({
      map: this.facade.map,
      emissive: "#ffd27a",
      emissiveMap: this.facade.glow,
      emissiveIntensity: 0,
    });
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(180, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: this.colors.top },
          mid: { value: this.colors.mid },
          horizon: { value: this.colors.horizon },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
          varying vec3 vDir;
          void main() {
            float h = max(vDir.y, 0.0);
            vec3 c = mix(horizon, mid, smoothstep(0.0, 0.16, h));
            c = mix(c, top, smoothstep(0.12, 0.75, h));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.dome.renderOrder = -1;
    this.group.add(this.dome);
    this.disposables.push(
      this.dome.geometry,
      this.dome.material,
      this.facades,
      this.facade.map,
      this.facade.glow,
      this.lamps,
    );

    this.buildAvenues();
  }

  /** The sky colour at the horizon, which the fog and the clear colour take. */
  horizon(dusk: number, rain: number, out: THREE.Color): THREE.Color {
    return sampleColor(out, keys.horizon, dusk).lerp(MIST, rain * 0.3);
  }

  update(dusk: number, night: number, rain: number): void {
    const { top, mid, horizon } = this.colors;
    sampleColor(top, keys.top, dusk).lerp(MIST, rain * 0.3);
    sampleColor(mid, keys.mid, dusk).lerp(MIST, rain * 0.3);
    sampleColor(horizon, keys.horizon, dusk).lerp(MIST, rain * 0.3);
    this.facades.emissiveIntensity = night * 1.15;
    this.lamps.color.lerpColors(new THREE.Color("#8f88b8"), new THREE.Color("#ffd58a"), night);
  }

  /** Tells the road paint how big the canvas is, so it can fade under the HUD. */
  setViewport(width: number, height: number, pixelRatio: number): void {
    const { bottom, top } = hudFadeBands(width, height);
    this.hudFade.bottomFadedToShown.value.set(...bottom);
    this.hudFade.topShownToFaded.value.set(...top);
    this.hudFade.heightPx.value = Math.max(1, height * pixelRatio);
  }

  /** Runs `render` with the road paint shown everywhere, for a picture with no HUD over it. */
  withoutHud<T>(render: () => T): T {
    const { bottomFadedToShown: bottom, topShownToFaded: top } = this.hudFade;
    const shown = { bottom: bottom.value.clone(), top: top.value.clone() };
    bottom.value.copy(NO_HUD.bottom);
    top.value.copy(NO_HUD.top);
    try {
      return render();
    } finally {
      bottom.value.copy(shown.bottom);
      top.value.copy(shown.top);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      if (o instanceof THREE.Mesh && !(o === this.dome)) o.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }

  private city(lots: Lot[], y = 0): void {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let level = 0; level < HEIGHTS.length; level++) {
      const mine = lots.filter((l) => l.level === level);
      if (!mine.length) continue;
      const mesh = new THREE.InstancedMesh(tiledTower(3.4, HEIGHTS[level] ?? 2, 3.4), this.facades, mine.length);
      mine.forEach((l, i) => {
        mesh.setMatrixAt(
          i,
          m.compose(new THREE.Vector3(l.x, y, l.z), new THREE.Quaternion(), new THREE.Vector3(l.sx, 1, l.sz)),
        );
        mesh.setColorAt(i, c.set(l.color));
      });
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  private buildAvenues(): void {
    const rnd = mulberry32(9);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const flat = new THREE.Quaternion();

    const asphalt = new THREE.Mesh(
      new THREE.CircleGeometry(150, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: STREET.asphalt, roughness: 0.95 }),
    );
    asphalt.receiveShadow = true;
    this.group.add(asphalt);

    const centres = [-108, -72, -36, 0, 36, 72, 108];
    const widths = [8, 8, 8, 12, 8, 8, 8];
    const spans: [number, number][] = [];
    for (let i = 0; i < centres.length - 1; i++) {
      spans.push([
        (centres[i] ?? 0) + (widths[i] ?? 0) / 2 + 0.8,
        (centres[i + 1] ?? 0) - (widths[i + 1] ?? 0) / 2 - 0.8,
      ]);
    }
    const blocks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.14, 1),
      new THREE.MeshStandardMaterial({ color: STREET.sidewalk, roughness: 0.95 }),
      spans.length ** 2,
    );
    const lots: Lot[] = [];
    let b = 0;
    for (const [x0, x1] of spans) {
      for (const [z0, z1] of spans) {
        blocks.setMatrixAt(
          b++,
          m.compose(
            new THREE.Vector3((x0 + x1) / 2, 0.07, (z0 + z1) / 2),
            flat,
            new THREE.Vector3(x1 - x0, 1, z1 - z0),
          ),
        );
        if (Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) > 100) continue;
        for (let x = x0 + 3; x < x1 - 2; x += 6.6) {
          for (let z = z0 + 3; z < z1 - 2; z += 6.6) {
            if (rnd() < 0.3) continue;
            lots.push({
              x,
              z,
              level: Math.min(4, Math.floor(rnd() * 3.4)),
              sx: 0.85 + rnd() * 0.4,
              sz: 0.85 + rnd() * 0.4,
              color: FACADES[Math.floor(rnd() * FACADES.length)] ?? "#ccc",
            });
          }
        }
      }
    }
    this.group.add(blocks);
    this.city(lots, 0.14);

    const marks: { x: number; z: number; w: number; l: number; along: "x" | "z"; color: string }[] = [];
    const dashed = (axis: "x" | "z", offset: number, from: number, to: number, color: string, dash = 1.6, gap = 2) => {
      for (let t = from; t < to; t += dash + gap)
        marks.push({
          x: axis === "z" ? offset : t + dash / 2,
          z: axis === "z" ? t + dash / 2 : offset,
          w: 0.12,
          l: dash,
          along: axis,
          color,
        });
    };
    const solid = (axis: "x" | "z", offset: number, from: number, to: number, color: string, w = 0.12) =>
      marks.push({
        x: axis === "z" ? offset : (from + to) / 2,
        z: axis === "z" ? (from + to) / 2 : offset,
        w,
        l: to - from,
        along: axis,
        color,
      });
    for (const axis of ["x", "z"] as const) {
      for (const sign of [-1, 1]) {
        const [a, z] = sign > 0 ? [7.4, 130] : [-130, -7.4];
        solid(axis, -0.2, a, z, CENTRE_LINE);
        solid(axis, 0.2, a, z, CENTRE_LINE);
        solid(axis, -5.4, a, z, PAINT);
        solid(axis, 5.4, a, z, PAINT);
        dashed(axis, -2.8, sign > 0 ? 9.5 : -130, sign > 0 ? 130 : -9.5, PAINT);
        dashed(axis, 2.8, sign > 0 ? 9.5 : -130, sign > 0 ? 130 : -9.5, PAINT);
        for (let s = -7; s <= 7; s++) {
          const at = sign * 8;
          marks.push({
            x: axis === "z" ? s * 0.62 : at,
            z: axis === "z" ? at : s * 0.62,
            w: 0.28,
            l: 1.0,
            along: axis,
            color: PAINT,
          });
        }
      }
    }
    for (const axis of ["x", "z"] as const) {
      for (const line of [-108, -72, -36, 36, 72, 108]) {
        solid(axis, line, -130, 130, CENTRE_LINE, 0.12);
        solid(axis, line - 3.4, -130, 130, PAINT, 0.12);
        solid(axis, line + 3.4, -130, 130, PAINT, 0.12);
      }
    }
    const paint = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      hudFadePaint(this.hudFade),
      marks.length,
    );
    marks.forEach((k, i) => {
      paint.setMatrixAt(
        i,
        m.compose(
          new THREE.Vector3(k.x, 0.012, k.z),
          flat,
          k.along === "x" ? new THREE.Vector3(k.l, 1, k.w) : new THREE.Vector3(k.w, 1, k.l),
        ),
      );
      paint.setColorAt(i, c.set(k.color));
    });
    paint.frustumCulled = false;
    this.group.add(paint);

    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6).translate(0, 1.6 + 0.14, 0),
      new THREE.MeshStandardMaterial({ color: COMBI.ink3, roughness: 0.6 }),
      96,
    );
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.14, 0.3), this.lamps, 96);
    let n = 0;
    for (const axis of ["x", "z"] as const) {
      for (const sign of [-1, 1]) {
        for (const side of [-1, 1]) {
          for (let t = 16; t < 82; t += 11) {
            const pos = new THREE.Vector3(
              axis === "z" ? side * 6.5 : sign * t,
              0,
              axis === "z" ? sign * t : side * 6.5,
            );
            poles.setMatrixAt(n, m.makeTranslation(pos.x, 0, pos.z));
            heads.setMatrixAt(
              n,
              m.makeTranslation(
                pos.x - (axis === "z" ? side * 0.35 : 0),
                3.4,
                pos.z - (axis === "x" ? side * 0.35 : 0),
              ),
            );
            n++;
          }
        }
      }
    }
    poles.count = heads.count = n;
    this.group.add(poles, heads);

    const car = new THREE.InstancedMesh(combiGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 18);
    const tints = [COMBI.yellow, COMBI.plate, COMBI.yellow, COMBI.red, "#c9d4dc"];
    for (let i = 0; i < 18; i++) {
      const axis = i % 2 ? "x" : "z";
      const t = (i % 3 === 0 ? -1 : 1) * (14 + rnd() * 52);
      const lane = (rnd() < 0.5 ? -1 : 1) * (1.4 + (rnd() < 0.5 ? 0 : 2.8));
      const turn = axis === "z" ? Math.PI / 2 : 0;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn + (lane > 0 ? 0 : Math.PI));
      car.setMatrixAt(
        i,
        m.compose(
          new THREE.Vector3(axis === "z" ? lane : t, 0, axis === "z" ? t : lane),
          q,
          new THREE.Vector3(1, 1, 1),
        ),
      );
      car.setColorAt(i, c.set(tints[i % tints.length] ?? COMBI.yellow));
    }
    car.castShadow = false;
    this.group.add(car);
  }
}

function combiGeometry(): THREE.BufferGeometry {
  const parts = [
    part(new THREE.BoxGeometry(1.8, 0.62, 0.78), "#ffffff", 0, 0.46, 0),
    part(new THREE.BoxGeometry(1.5, 0.22, 0.8), "#10121a", -0.05, 0.62, 0),
    part(new THREE.BoxGeometry(1.84, 0.07, 0.8), "#ffffff", 0, 0.84, 0),
    ...[-0.55, 0.55].flatMap((x) =>
      [-0.34, 0.34].map((z) =>
        part(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 8).rotateX(Math.PI / 2), "#08090c", x, 0.15, z),
      ),
    ),
  ];
  return mergeGeometries(parts, false);
}
