import * as THREE from "three";

import type { Deck } from "../../../shared/board.ts";
import { FONT } from "./boardTexture.ts";
import { easeIn, easeOut } from "./effects.ts";
import { drawIcon } from "./icons.ts";
import { COMBI } from "./palette.ts";

const CARD_W = 1.3;
const CARD_D = 0.82;
const STACK_H = 0.15;
const CARD_THICKNESS = 0.012;
export const LIFT_MS = 1500;
const LIFT_HEIGHT = 0.55;

const DECKS: Record<Deck, { title: string; field: string; icon: "clover" | "coins"; at: [number, number] }> = {
  suerte: { title: "SUERTE", field: COMBI.suerte, icon: "clover", at: [-3.45, -3.45] },
  caja: { title: "CAJA MUNICIPAL", field: COMBI.caja, icon: "coins", at: [3.45, 3.45] },
};

const LOOSE_TOP_CARDS = [
  { x: 0.03, z: -0.02, r: 0.06 },
  { x: -0.04, z: 0.025, r: -0.05 },
] as const;

function drawBack(canvas: HTMLCanvasElement, deck: Deck): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  const d = DECKS[deck];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COMBI.black;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h * 0.07);
  ctx.fill();
  ctx.fillStyle = d.field;
  ctx.beginPath();
  ctx.roundRect(h * 0.04, h * 0.04, w - h * 0.08, h * 0.92, h * 0.05);
  ctx.fill();
  ctx.strokeStyle = COMBI.black;
  ctx.lineWidth = h * 0.015;
  ctx.beginPath();
  ctx.roundRect(h * 0.09, h * 0.09, w - h * 0.18, h * 0.82, h * 0.035);
  ctx.stroke();
  drawIcon(ctx, d.icon, w * 0.5, h * 0.36, h * 0.17, COMBI.plate);
  ctx.fillStyle = COMBI.black;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `condensed 800 ${Math.round(h * (d.title.length > 8 ? 0.15 : 0.19))}px ${FONT}`;
  ctx.fillText(d.title, w / 2, h * 0.73);
}

function drawFace(canvas: HTMLCanvasElement, deck: Deck): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = COMBI.plate;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = DECKS[deck].field;
  ctx.fillRect(0, 0, w, h * 0.22);
  ctx.fillStyle = "#c9c2ad";
  for (let line = 0; line < 3; line++)
    ctx.fillRect(w * 0.14, h * (0.4 + line * 0.15), w * (line === 2 ? 0.45 : 0.72), h * 0.05);
}

function canvasTexture(width: number, height: number, draw: (canvas: HTMLCanvasElement) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function edgeTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(8, 64, (canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = COMBI.plate;
    ctx.fillRect(0, 0, 8, 64);
    ctx.fillStyle = "#a8a290";
    for (let y = 0; y < 64; y += 5) ctx.fillRect(0, y, 8, 1);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** three.js draws once per geometry group: four sides in one group, then back and face, gives three draws instead of BoxGeometry's six. */
function cardGeometry(w: number, h: number, d: number): THREE.BoxGeometry {
  const box = new THREE.BoxGeometry(w, h, d);
  const index = box.getIndex();
  if (!index) return box;
  // BoxGeometry's faces, six indices each: +x, -x, +y, -y, +z, -z.
  const face = (n: number) => Array.from(index.array.slice(n * 6, n * 6 + 6));
  box.setIndex([0, 1, 4, 5, 2, 3].flatMap(face));
  box.clearGroups();
  box.addGroup(0, 24, 0);
  box.addGroup(24, 6, 1);
  box.addGroup(30, 6, 2);
  return box;
}

/** Where the drawn card is, `t` from 0 to 1 through the lift: up and over, a beat face up, then back on the deck. */
export function liftPose(t: number): { y: number; flip: number } {
  const up = easeOut(THREE.MathUtils.clamp(t / 0.35, 0, 1));
  const down = easeIn(THREE.MathUtils.clamp((t - 0.7) / 0.3, 0, 1));
  const over = THREE.MathUtils.smoothstep(t, 0.05, 0.4) - THREE.MathUtils.smoothstep(t, 0.68, 0.95);
  return { y: LIFT_HEIGHT * (up - down), flip: Math.PI * over };
}

interface Stack {
  card: THREE.Mesh;
  rest: THREE.Vector3;
  back: HTMLCanvasElement;
  textures: THREE.CanvasTexture[];
}

export class CardStacks {
  readonly group = new THREE.Group();
  private readonly stacks = new Map<Deck, Stack>();
  private readonly reducedMotion: boolean;
  private lifting: { stack: Stack; start: number } | null = null;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
    const edgeMaterial = new THREE.MeshStandardMaterial({ map: edgeTexture(), roughness: 0.7 });
    const card = cardGeometry(CARD_W, CARD_THICKNESS, CARD_D);
    const body = cardGeometry(CARD_W, STACK_H, CARD_D);

    for (const deck of Object.keys(DECKS) as Deck[]) {
      const d = DECKS[deck];
      const backTexture = canvasTexture(512, 320, (c) => drawBack(c, deck));
      const faceTexture = canvasTexture(256, 160, (c) => drawFace(c, deck));
      const back = new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.55 });
      const face = new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.6 });
      const sides = [edgeMaterial, back, face];

      const stack = new THREE.Group();
      stack.position.set(d.at[0], 0.35, d.at[1]);
      stack.rotation.y = Math.PI / 4;
      const pile = new THREE.Mesh(body, sides);
      pile.position.y = STACK_H / 2;
      pile.castShadow = pile.receiveShadow = true;
      stack.add(pile);
      let top = pile;
      LOOSE_TOP_CARDS.forEach((s, n) => {
        top = new THREE.Mesh(card, sides);
        top.position.set(s.x, STACK_H + CARD_THICKNESS * (n + 0.5), s.z);
        top.rotation.y = s.r;
        top.castShadow = true;
        stack.add(top);
      });
      this.group.add(stack);
      this.stacks.set(deck, {
        card: top,
        rest: top.position.clone(),
        back: backTexture.image as HTMLCanvasElement,
        textures: [backTexture, faceTexture],
      });
    }
  }

  /** Draws the card backs again, once the web font has arrived. */
  refresh(): void {
    for (const [deck, stack] of this.stacks) {
      drawBack(stack.back, deck);
      for (const texture of stack.textures) texture.needsUpdate = true;
    }
  }

  /** Starts the top card of `deck` lifting and flipping; settles any lift in progress; does nothing under reduced motion. */
  lift(deck: Deck, now: number): void {
    if (this.reducedMotion) return;
    if (this.lifting) this.settle(this.lifting.stack);
    const stack = this.stacks.get(deck);
    if (stack) this.lifting = { stack, start: now };
  }

  update(now: number): void {
    if (!this.lifting) return;
    const { stack, start } = this.lifting;
    const t = (now - start) / LIFT_MS;
    if (t >= 1) {
      this.settle(stack);
      this.lifting = null;
      return;
    }
    const pose = liftPose(Math.max(0, t));
    stack.card.position.y = stack.rest.y + pose.y;
    stack.card.rotation.x = pose.flip;
  }

  private settle(stack: Stack): void {
    stack.card.position.copy(stack.rest);
    stack.card.rotation.x = 0;
  }
}
