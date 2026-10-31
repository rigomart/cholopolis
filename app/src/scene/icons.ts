import { COMBI } from "./palette.ts";

export type IconName =
  | "metro"
  | "bus"
  | "plane"
  | "train"
  | "bulb"
  | "drop"
  | "receipt"
  | "town"
  | "clover"
  | "coins"
  | "cat"
  | "siren"
  | "bars"
  | "flag";

/** Draws in a box from -1 to 1 around the origin; `fill` fills the current path in the icon's colour. */
type Draw = (ctx: CanvasRenderingContext2D, fill: () => void) => void;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const ICONS: Record<IconName, Draw> = {
  metro: (ctx, fill) => {
    roundRect(ctx, -0.55, -0.6, 1.1, 1.15, 0.22);
    fill();
    ctx.stroke();
    roundRect(ctx, -0.38, -0.42, 0.76, 0.42, 0.08);
    ctx.fillStyle = COMBI.plate;
    ctx.fill();
    ctx.fillStyle = COMBI.black;
    ctx.stroke();
    for (const x of [-0.27, 0.27]) {
      ctx.beginPath();
      ctx.arc(x, 0.3, 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-0.35, 0.55);
    ctx.lineTo(-0.5, 0.85);
    ctx.moveTo(0.35, 0.55);
    ctx.lineTo(0.5, 0.85);
    ctx.moveTo(-0.3, -0.8);
    ctx.lineTo(0.3, -0.8);
    ctx.moveTo(0, -0.8);
    ctx.lineTo(0, -0.6);
    ctx.stroke();
  },
  bus: (ctx, fill) => {
    roundRect(ctx, -0.9, -0.5, 1.8, 0.9, 0.16);
    fill();
    ctx.stroke();
    ctx.fillStyle = COMBI.plate;
    for (const x of [-0.62, -0.12, 0.38]) {
      roundRect(ctx, x, -0.34, 0.36, 0.3, 0.05);
      ctx.fill();
      ctx.stroke();
    }
    for (const x of [-0.5, 0.5]) {
      ctx.beginPath();
      ctx.arc(x, 0.42, 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = COMBI.black;
  },
  plane: (ctx, fill) => {
    ctx.beginPath();
    ctx.moveTo(-0.9, 0.05);
    ctx.lineTo(-0.25, -0.12);
    ctx.lineTo(-0.5, -0.8);
    ctx.lineTo(-0.28, -0.8);
    ctx.lineTo(0.35, -0.2);
    ctx.lineTo(0.85, -0.3);
    ctx.quadraticCurveTo(0.95, -0.2, 0.85, -0.05);
    ctx.lineTo(0.35, 0.05);
    ctx.lineTo(0.35, 0.05);
    ctx.lineTo(-0.28, 0.8);
    ctx.lineTo(-0.5, 0.8);
    ctx.lineTo(-0.25, 0.12);
    ctx.closePath();
    fill();
    ctx.stroke();
  },
  train: (ctx, fill) => {
    ctx.beginPath();
    ctx.moveTo(-0.95, -0.2);
    ctx.lineTo(-0.5, -0.8);
    ctx.lineTo(-0.2, -0.42);
    ctx.lineTo(0.15, -0.9);
    ctx.lineTo(0.6, -0.2);
    ctx.stroke();
    roundRect(ctx, -0.8, -0.05, 1.6, 0.62, 0.12);
    fill();
    ctx.stroke();
    ctx.fillStyle = COMBI.plate;
    for (const x of [-0.6, -0.12, 0.36]) {
      roundRect(ctx, x, 0.08, 0.3, 0.2, 0.04);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = COMBI.black;
    ctx.beginPath();
    ctx.moveTo(-0.95, 0.85);
    ctx.lineTo(0.95, 0.85);
    ctx.stroke();
  },
  bulb: (ctx, fill) => {
    ctx.beginPath();
    ctx.arc(0, -0.2, 0.52, Math.PI * 0.8, Math.PI * 0.2);
    ctx.lineTo(0.2, 0.45);
    ctx.lineTo(-0.2, 0.45);
    ctx.closePath();
    fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.18, 0.66);
    ctx.lineTo(0.18, 0.66);
    ctx.moveTo(-0.1, 0.86);
    ctx.lineTo(0.1, 0.86);
    ctx.moveTo(-0.12, 0.05);
    ctx.lineTo(0, -0.12);
    ctx.lineTo(0.12, 0.05);
    ctx.stroke();
  },
  drop: (ctx, fill) => {
    ctx.beginPath();
    ctx.moveTo(0, -0.9);
    ctx.bezierCurveTo(0.2, -0.5, 0.62, -0.1, 0.62, 0.28);
    ctx.arc(0, 0.28, 0.62, 0, Math.PI);
    ctx.bezierCurveTo(-0.62, -0.1, -0.2, -0.5, 0, -0.9);
    ctx.closePath();
    fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.3, 0.3);
    ctx.quadraticCurveTo(-0.28, 0.5, -0.06, 0.55);
    ctx.strokeStyle = COMBI.plate;
    ctx.stroke();
    ctx.strokeStyle = COMBI.black;
  },
  receipt: (ctx, fill) => {
    ctx.beginPath();
    ctx.moveTo(-0.6, -0.9);
    ctx.lineTo(0.6, -0.9);
    ctx.lineTo(0.6, 0.9);
    for (let i = 0; i < 4; i++) {
      ctx.lineTo(0.6 - (i + 0.5) * 0.3, 0.7);
      ctx.lineTo(0.6 - (i + 1) * 0.3, 0.9);
    }
    ctx.closePath();
    fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.28, -0.42);
    ctx.lineTo(-0.28, 0.3);
    ctx.stroke();
    for (const [x, y] of [
      [-0.26, -0.4],
      [0.26, 0.28],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 0.13, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  town: (ctx, fill) => {
    ctx.beginPath();
    ctx.moveTo(-0.95, -0.3);
    ctx.lineTo(0, -0.9);
    ctx.lineTo(0.95, -0.3);
    ctx.closePath();
    fill();
    ctx.stroke();
    for (const x of [-0.6, -0.2, 0.2, 0.6]) {
      ctx.beginPath();
      ctx.moveTo(x, -0.12);
      ctx.lineTo(x, 0.5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-0.9, 0.7);
    ctx.lineTo(0.9, 0.7);
    ctx.moveTo(-0.75, 0.5);
    ctx.lineTo(0.75, 0.5);
    ctx.stroke();
  },
  clover: (ctx, fill) => {
    for (const [x, y] of [
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.3, 0.3],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 0.3, 0, Math.PI * 2);
      fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0.05, 0.4);
    ctx.quadraticCurveTo(0.1, 0.75, 0.5, 0.95);
    ctx.stroke();
  },
  coins: (ctx, fill) => {
    for (const y of [0.45, 0.05, -0.35]) {
      ctx.beginPath();
      ctx.ellipse(0, y, 0.72, 0.26, 0, 0, Math.PI * 2);
      fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-0.72, 0.05);
    ctx.lineTo(-0.72, 0.45);
    ctx.moveTo(0.72, 0.05);
    ctx.lineTo(0.72, 0.45);
    ctx.stroke();
  },
  cat: (ctx, fill) => {
    ctx.beginPath();
    ctx.moveTo(-0.45, -0.25);
    ctx.lineTo(-0.5, -0.85);
    ctx.lineTo(-0.15, -0.6);
    ctx.quadraticCurveTo(0, -0.66, 0.15, -0.6);
    ctx.lineTo(0.5, -0.85);
    ctx.lineTo(0.45, -0.25);
    ctx.quadraticCurveTo(0.62, 0.2, 0.55, 0.85);
    ctx.lineTo(-0.55, 0.85);
    ctx.quadraticCurveTo(-0.62, 0.2, -0.45, -0.25);
    ctx.closePath();
    fill();
    ctx.stroke();
    for (const x of [-0.2, 0.2]) {
      ctx.beginPath();
      ctx.arc(x, -0.3, 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(0.55, 0.7);
    ctx.quadraticCurveTo(0.95, 0.7, 0.88, 0.3);
    ctx.stroke();
  },
  siren: (ctx, fill) => {
    ctx.beginPath();
    ctx.arc(0, 0.25, 0.55, Math.PI, 0);
    ctx.lineTo(0.55, 0.55);
    ctx.lineTo(-0.55, 0.55);
    ctx.closePath();
    fill();
    ctx.stroke();
    roundRect(ctx, -0.8, 0.55, 1.6, 0.28, 0.06);
    ctx.stroke();
    ctx.beginPath();
    for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) {
      ctx.moveTo(Math.sin(a) * 0.72, 0.25 - Math.cos(a) * 0.72);
      ctx.lineTo(Math.sin(a) * 0.95, 0.25 - Math.cos(a) * 0.95);
    }
    ctx.stroke();
  },
  bars: (ctx, fill) => {
    roundRect(ctx, -0.75, -0.8, 1.5, 1.6, 0.14);
    fill();
    ctx.stroke();
    for (const x of [-0.4, 0, 0.4]) {
      ctx.beginPath();
      ctx.moveTo(x, -0.8);
      ctx.lineTo(x, 0.8);
      ctx.stroke();
    }
  },
  flag: (ctx, fill) => {
    ctx.beginPath();
    ctx.moveTo(-0.6, 0.9);
    ctx.lineTo(-0.6, -0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.6, -0.85);
    ctx.lineTo(0.8, -0.85);
    ctx.lineTo(0.8, 0.1);
    ctx.lineTo(-0.6, 0.1);
    ctx.closePath();
    fill();
    ctx.stroke();
    for (const [x, y] of [
      [0.0, -0.85],
      [0.4, -0.85],
      [-0.2, -0.38],
      [0.2, -0.38],
      [0.6, -0.38],
      [0.0, 0.1],
    ] as const) {
      ctx.fillRect(x - 0.2, y, 0.2, 0.47);
    }
  },
};

export const ICON_FILL: Record<IconName, string> = {
  metro: "#16b455",
  bus: "#e4372d",
  plane: "#c9d4dc",
  train: "#2f5fb3",
  bulb: COMBI.yellow,
  drop: COMBI.caja,
  receipt: "#ffffff",
  town: "#d8c9a8",
  clover: "#16b455",
  coins: "#e0a24a",
  cat: "#f0a050",
  siren: "#4cc3ff",
  bars: "#8b93a3",
  flag: "#ffffff",
};

/** Draws `name` centred on (x, y), `radius` pixels from the centre to the edge, in ink with its fill colour. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  x: number,
  y: number,
  radius: number,
  color: string = ICON_FILL[name],
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(radius, radius);
  ctx.lineWidth = 0.12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = COMBI.black;
  ctx.fillStyle = COMBI.black;
  ICONS[name](ctx, () => {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = COMBI.black;
  });
  ctx.restore();
}
