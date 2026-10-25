import * as THREE from "three";

import { PIECES, type PieceId } from "../../../shared/pieces.ts";

/**
 * Low-poly player tokens built from primitives, about 0.5 units tall on a 0.17-radius base in the
 * player's color. Models face +x (their direction of travel); `faceViewer` ones stay facing +z
 * because they read best from the front.
 */

export const BASE_HEIGHT = 0.035;

const INK = "#1b1240";

interface Part {
  geo: THREE.BufferGeometry;
  color: string;
  at?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  material?: Partial<THREE.MeshStandardMaterialParameters>;
}

const sphere = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cyl = (top: number, bottom: number, h: number, seg = 10) => new THREE.CylinderGeometry(top, bottom, h, seg);
const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const torus = (r: number, tube: number, arc = Math.PI * 2, seg = 16) => new THREE.TorusGeometry(r, tube, 6, seg, arc);

/** Half a disc, flat edge along x, curved edge below (`down`) or above, extruded `depth` along z. */
function halfDisc(r: number, depth: number, down = true): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  shape.absarc(0, 0, r, Math.PI, down ? Math.PI * 2 : 0, !down);
  shape.lineTo(-r, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 14 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function assemble(parts: Part[]): THREE.Group {
  const group = new THREE.Group();
  for (const p of parts) {
    const material = new THREE.MeshStandardMaterial({
      color: p.color,
      roughness: 0.55,
      flatShading: true,
      ...p.material,
    });
    const mesh = new THREE.Mesh(p.geo, material);
    if (p.at) mesh.position.set(...p.at);
    if (p.rot) mesh.rotation.set(...p.rot);
    if (p.scale) mesh.scale.set(...p.scale);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

const B = BASE_HEIGHT;

function llama(accent: string): Part[] {
  const wool = "#efe3cc";
  const muzzle = "#d8c6a6";
  const parts: Part[] = [
    { geo: sphere(0.13), color: wool, at: [0, B + 0.25, 0], scale: [1.35, 0.82, 0.8] },
    { geo: cyl(0.045, 0.058, 0.22, 8), color: wool, at: [0.13, B + 0.38, 0], rot: [0, 0, -0.22] },
    { geo: sphere(0.06), color: wool, at: [0.17, B + 0.5, 0], scale: [1.3, 0.9, 0.85] },
    { geo: sphere(0.036), color: muzzle, at: [0.235, B + 0.485, 0] },
    { geo: sphere(0.034), color: wool, at: [-0.18, B + 0.29, 0] },
    // Saddle blanket with a contrasting fringe, as on llamas dressed for festivals.
    { geo: box(0.17, 0.03, 0.21), color: accent, at: [-0.01, B + 0.355, 0], rot: [0, 0, 0.05] },
    { geo: box(0.175, 0.02, 0.215), color: "#ffe500", at: [-0.01, B + 0.33, 0], rot: [0, 0, 0.05] },
  ];
  for (const z of [-1, 1]) {
    parts.push(
      { geo: cone(0.018, 0.07, 5), color: wool, at: [0.15, B + 0.58, z * 0.03], rot: [z * 0.25, 0, 0] },
      { geo: sphere(0.02, 6, 5), color: accent, at: [0.15, B + 0.62, z * 0.042] },
      { geo: sphere(0.011, 6, 5), color: INK, at: [0.215, B + 0.52, z * 0.042] },
    );
    for (const x of [-1, 1]) {
      parts.push({ geo: cyl(0.024, 0.02, 0.2, 6), color: wool, at: [x * 0.1, B + 0.1, z * 0.06] });
    }
  }
  return parts;
}

function cuy(accent: string): Part[] {
  const fur = "#f6f0e6";
  const patch = "#c8742c";
  const parts: Part[] = [
    { geo: sphere(0.12), color: fur, at: [0, B + 0.13, 0], scale: [1.45, 0.95, 1] },
    { geo: sphere(0.1), color: patch, at: [-0.07, B + 0.16, 0], scale: [1, 0.85, 1.06] },
    { geo: sphere(0.085), color: fur, at: [0.15, B + 0.16, 0] },
    { geo: sphere(0.06), color: patch, at: [0.14, B + 0.2, 0], scale: [1, 0.7, 1.15] },
    { geo: sphere(0.016, 6, 5), color: "#f29aa8", at: [0.235, B + 0.15, 0] },
    // A scarf in the player's color, because it gets cold in the Andes.
    { geo: torus(0.075, 0.02), color: accent, at: [0.1, B + 0.14, 0], rot: [0, Math.PI / 2, 0] },
  ];
  for (const z of [-1, 1]) {
    parts.push(
      { geo: sphere(0.03, 6, 5), color: "#b36a3a", at: [0.13, B + 0.245, z * 0.06], scale: [0.45, 1, 1] },
      { geo: sphere(0.013, 6, 5), color: INK, at: [0.205, B + 0.19, z * 0.05] },
      { geo: sphere(0.025, 6, 5), color: "#f2c5b5", at: [0.08, B + 0.02, z * 0.08] },
      { geo: sphere(0.025, 6, 5), color: "#f2c5b5", at: [-0.12, B + 0.02, z * 0.08] },
    );
  }
  return parts;
}

function combi(accent: string): Part[] {
  const glass = "#20304a";
  const parts: Part[] = [
    { geo: box(0.42, 0.15, 0.2), color: accent, at: [0, B + 0.12, 0] },
    { geo: box(0.425, 0.03, 0.205), color: "#ffffff", at: [0, B + 0.07, 0] },
    { geo: box(0.36, 0.065, 0.205), color: glass, at: [-0.02, B + 0.195, 0], material: { roughness: 0.2 } },
    { geo: box(0.37, 0.03, 0.19), color: "#ffffff", at: [-0.02, B + 0.24, 0] },
    { geo: box(0.012, 0.07, 0.17), color: glass, at: [0.211, B + 0.19, 0], material: { roughness: 0.2 } },
    // Roof rack with a bundle, and the hand-painted route stripe.
    { geo: box(0.2, 0.015, 0.15), color: "#5a4636", at: [-0.05, B + 0.262, 0] },
    { geo: box(0.1, 0.05, 0.1), color: "#c94f2b", at: [-0.07, B + 0.29, 0] },
    { geo: box(0.426, 0.02, 0.206), color: "#ffe500", at: [0, B + 0.15, 0] },
  ];
  for (const z of [-1, 1]) {
    parts.push({
      geo: sphere(0.018, 6, 5),
      color: "#fff6b0",
      at: [0.212, B + 0.1, z * 0.07],
      material: { emissive: "#ffe9a0", emissiveIntensity: 0.4 },
    });
    for (const x of [-1, 1]) {
      parts.push({
        geo: cyl(0.045, 0.045, 0.035, 12),
        color: "#222",
        at: [x * 0.13, B + 0.045, z * 0.1],
        rot: [Math.PI / 2, 0, 0],
      });
    }
  }
  return parts;
}

function mototaxi(accent: string): Part[] {
  const frame = "#2c2c34";
  const parts: Part[] = [
    { geo: box(0.17, 0.11, 0.24), color: accent, at: [-0.06, B + 0.12, 0] },
    { geo: box(0.03, 0.12, 0.22), color: frame, at: [-0.14, B + 0.23, 0] },
    { geo: box(0.13, 0.03, 0.2), color: "#7a1f2b", at: [-0.06, B + 0.185, 0] },
    { geo: box(0.25, 0.02, 0.27), color: accent, at: [-0.04, B + 0.34, 0] },
    { geo: box(0.255, 0.012, 0.275), color: "#ffe500", at: [-0.04, B + 0.325, 0] },
    { geo: box(0.14, 0.05, 0.05), color: frame, at: [0.09, B + 0.14, 0], rot: [0, 0, 0.18] },
    { geo: cyl(0.01, 0.01, 0.17, 6), color: "#888", at: [0.165, B + 0.12, 0], rot: [0, 0, 0.35] },
    { geo: cyl(0.008, 0.008, 0.15, 6), color: frame, at: [0.14, B + 0.21, 0], rot: [Math.PI / 2, 0, 0] },
    {
      geo: sphere(0.02, 6, 5),
      color: "#fff6b0",
      at: [0.18, B + 0.18, 0],
      material: { emissive: "#ffe9a0", emissiveIntensity: 0.4 },
    },
    { geo: cyl(0.045, 0.045, 0.03, 12), color: "#222", at: [0.19, B + 0.045, 0], rot: [Math.PI / 2, 0, 0] },
  ];
  for (const z of [-1, 1]) {
    parts.push({
      geo: cyl(0.045, 0.045, 0.03, 12),
      color: "#222",
      at: [-0.08, B + 0.045, z * 0.135],
      rot: [Math.PI / 2, 0, 0],
    });
    for (const x of [-0.15, 0.07]) {
      parts.push({ geo: cyl(0.007, 0.007, 0.16, 5), color: frame, at: [x, B + 0.255, z * 0.12] });
    }
  }
  return parts;
}

/** Andean knit: bands of zigzags and diamonds around the player's color. */
function knitTexture(accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const bands = [accent, "#ffffff", "#e5322d", accent, "#ffe500", "#1b1240", accent, "#ffffff"];
    const h = 128 / bands.length;
    bands.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * h, 128, h);
      if (i % 2 === 1) {
        ctx.fillStyle = i % 4 === 1 ? "#e5322d" : accent;
        for (let x = 0; x < 128; x += 16) {
          ctx.beginPath();
          ctx.moveTo(x, i * h + h);
          ctx.lineTo(x + 8, i * h + 2);
          ctx.lineTo(x + 16, i * h + h);
          ctx.fill();
        }
      }
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function chullo(accent: string): Part[] {
  const knit = knitTexture(accent);
  const dome = new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const parts: Part[] = [
    {
      geo: dome,
      color: "#ffffff",
      at: [0, B + 0.13, 0],
      scale: [1, 1.35, 1],
      material: { map: knit, flatShading: false, side: THREE.DoubleSide },
    },
    {
      geo: cyl(0.137, 0.137, 0.05, 14),
      color: "#ffffff",
      at: [0, B + 0.11, 0],
      material: { map: knit, flatShading: false },
    },
    { geo: sphere(0.042, 8, 6), color: accent, at: [0, B + 0.33, 0] },
  ];
  for (const z of [-1, 1]) {
    parts.push(
      {
        geo: cone(0.07, 0.15, 6),
        color: "#e5322d",
        at: [0, B + 0.06, z * 0.125],
        rot: [Math.PI, 0, 0],
        scale: [1, 1, 0.45],
      },
      { geo: cyl(0.008, 0.008, 0.09, 4), color: accent, at: [0, B + 0.0, z * 0.13] },
      { geo: sphere(0.022, 6, 5), color: accent, at: [0, B - 0.01, z * 0.13] },
    );
  }
  return parts;
}

function torito(accent: string): Part[] {
  const clay = "#c98a4b";
  const cream = "#f3e4c4";
  const glaze = { roughness: 0.3, flatShading: false };
  const parts: Part[] = [
    { geo: sphere(0.12, 12, 10), color: clay, at: [0, B + 0.2, 0], scale: [1.4, 0.9, 0.85], material: glaze },
    { geo: sphere(0.075, 12, 10), color: clay, at: [0.17, B + 0.29, 0], scale: [1.1, 1, 0.9], material: glaze },
    { geo: sphere(0.045, 10, 8), color: cream, at: [0.235, B + 0.265, 0], material: glaze },
    {
      geo: torus(0.065, 0.013, Math.PI, 12),
      color: cream,
      at: [0.16, B + 0.34, 0],
      rot: [0, Math.PI / 2, 0],
      material: glaze,
    },
    // The vessel's mouth on the back, and the painted collar.
    { geo: cyl(0.025, 0.03, 0.06, 10), color: cream, at: [-0.03, B + 0.3, 0], material: glaze },
    { geo: torus(0.07, 0.014), color: accent, at: [0.11, B + 0.26, 0], rot: [0, Math.PI / 2, 0.35], material: glaze },
    { geo: cyl(0.008, 0.008, 0.12, 5), color: clay, at: [-0.18, B + 0.17, 0], rot: [0, 0, -0.5] },
  ];
  for (const z of [-1, 1]) {
    parts.push(
      { geo: sphere(0.02, 8, 6), color: INK, at: [0.205, B + 0.32, z * 0.05], material: glaze },
      { geo: sphere(0.018, 6, 5), color: accent, at: [0.02, B + 0.24, z * 0.1], material: glaze },
      { geo: sphere(0.018, 6, 5), color: accent, at: [-0.08, B + 0.2, z * 0.1], material: glaze },
    );
    for (const x of [-1, 1]) {
      parts.push({ geo: cyl(0.034, 0.03, 0.12, 8), color: clay, at: [x * 0.09, B + 0.06, z * 0.055], material: glaze });
    }
  }
  return parts;
}

function tumi(accent: string): Part[] {
  // Satin rather than mirror gold: the scene has no reflections for a true metal to show.
  const gold = { metalness: 0.35, roughness: 0.32, flatShading: false, emissive: "#3a2600", emissiveIntensity: 0.25 };
  const g = "#f0c03a";
  const parts: Part[] = [
    { geo: halfDisc(0.13, 0.02), color: g, at: [0, B + 0.17, 0], material: gold },
    { geo: box(0.05, 0.14, 0.03), color: g, at: [0, B + 0.24, 0], material: gold },
    { geo: box(0.085, 0.065, 0.04), color: g, at: [0, B + 0.34, 0], material: gold },
    { geo: halfDisc(0.075, 0.015, false), color: g, at: [0, B + 0.37, 0], material: gold },
    // Turquoise inlays, and a gem in the player's color.
    {
      geo: sphere(0.016, 8, 6),
      color: accent,
      at: [0, B + 0.24, 0.018],
      material: { roughness: 0.2, flatShading: false },
    },
    { geo: box(0.05, 0.01, 0.012), color: "#2ec4b6", at: [0, B + 0.325, 0.022] },
  ];
  for (const x of [-1, 1]) {
    parts.push(
      { geo: sphere(0.01, 6, 5), color: INK, at: [x * 0.018, B + 0.35, 0.021] },
      { geo: cyl(0.016, 0.016, 0.01, 8), color: "#2ec4b6", at: [x * 0.048, B + 0.34, 0], rot: [0, 0, Math.PI / 2] },
      { geo: sphere(0.012, 6, 5), color: accent, at: [x * 0.055, B + 0.41, 0.01] },
    );
  }
  return parts;
}

function huaco(accent: string): Part[] {
  const clay = "#b5653a";
  const cream = "#efdcb8";
  const glaze = { roughness: 0.45, flatShading: false };
  const body = new THREE.LatheGeometry(
    [
      [0, 0],
      [0.085, 0],
      [0.12, 0.04],
      [0.13, 0.1],
      [0.11, 0.16],
      [0.06, 0.2],
      [0, 0.21],
    ].map(([r, h]) => new THREE.Vector2(r, h)),
    16,
  );
  return [
    { geo: body, color: clay, at: [0, B, 0], material: glaze },
    {
      geo: torus(0.13, 0.009, Math.PI * 2, 24),
      color: cream,
      at: [0, B + 0.1, 0],
      rot: [Math.PI / 2, 0, 0],
      material: glaze,
    },
    {
      geo: torus(0.124, 0.011, Math.PI * 2, 24),
      color: accent,
      at: [0, B + 0.065, 0],
      rot: [Math.PI / 2, 0, 0],
      material: glaze,
    },
    // The stirrup spout that makes it Moche.
    { geo: torus(0.06, 0.017, Math.PI, 14), color: clay, at: [0, B + 0.2, 0], material: glaze },
    { geo: cyl(0.016, 0.019, 0.09, 10), color: clay, at: [0, B + 0.305, 0], material: glaze },
    {
      geo: torus(0.017, 0.005, Math.PI * 2, 10),
      color: cream,
      at: [0, B + 0.35, 0],
      rot: [Math.PI / 2, 0, 0],
      material: glaze,
    },
  ];
}

const BUILDERS: Record<PieceId, (accent: string) => Part[]> = {
  llama,
  cuy,
  combi,
  mototaxi,
  chullo,
  torito,
  tumi,
  huaco,
};

/**
 * Pieces that read best from the front: they keep this heading instead of turning to face where
 * they walk. The chullo is turned so its ear flaps hang to the sides.
 */
const FIXED_HEADING: Partial<Record<PieceId, number>> = { chullo: Math.PI / 2, tumi: 0, huaco: 0 };

export function pieceId(index: number): PieceId {
  return PIECES[index]?.id ?? "llama";
}

/** A ready-to-place token: the model on a base disc in the player's color. */
export function buildPiece(index: number, accent: string): THREE.Group {
  const id = pieceId(index);
  const group = assemble([
    { geo: cyl(0.17, 0.17, B, 20), color: accent, at: [0, B / 2, 0], material: { roughness: 0.4, flatShading: false } },
    { geo: torus(0.17, 0.012, Math.PI * 2, 24), color: INK, at: [0, B, 0], rot: [Math.PI / 2, 0, 0] },
    ...BUILDERS[id](accent),
  ]);
  group.userData.fixedHeading = FIXED_HEADING[id] ?? null;
  return group;
}
