import { BOARD, GROUP_COLORS, type Square } from "../../../shared/board.ts";
import { money } from "../../../shared/game.ts";
import { drawIcon, type IconName } from "./icons.ts";
import { BAND, BOARD_SIZE, HALF, INNER } from "./layout.ts";
import { COMBI, STREET } from "./palette.ts";

export const FONT = "'Bricolage Grotesque Variable', system-ui, sans-serif";
export const INK = COMBI.ink;
/** Wordmark and party colours; the board face paints with `COMBI`. */
export const CHICHA = ["#ff2e88", "#ff7a1a", "#ffe500", "#2bff88"] as const;

const ICONS: Record<string, IconName> = {
  "Línea 1 del Metro": "metro",
  Metropolitano: "bus",
  "Aeropuerto Jorge Chávez": "plane",
  "Tren a Machu Picchu": "train",
  "Luz del Sur": "bulb",
  Sedapal: "drop",
  "Impuesto SUNAT": "receipt",
  "Arbitrios municipales": "town",
  Suerte: "clover",
  "Caja Municipal": "coins",
};

function bandFill(ctx: CanvasRenderingContext2D, sq: Square, u: number, w: number): void {
  if (sq.kind === "street") {
    ctx.fillStyle = GROUP_COLORS[sq.group];
    ctx.fillRect(0, 0, w, BAND * u);
    return;
  }
  if (sq.kind === "tax") {
    hazard(ctx, 0, 0, w, BAND * u, 0.22 * u);
    return;
  }
  ctx.fillStyle = sq.kind === "card" ? (sq.deck === "suerte" ? COMBI.suerte : COMBI.caja) : COMBI.black;
  ctx.fillRect(0, 0, w, BAND * u);
}

function hazard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = COMBI.yellow;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COMBI.black;
  for (let s = -h; s < w + h; s += step * 2) {
    ctx.beginPath();
    ctx.moveTo(x + s, y + h);
    ctx.lineTo(x + s + step, y + h);
    ctx.lineTo(x + s + step + h, y);
    ctx.lineTo(x + s + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Paints the board face onto `canvas`, which must be square; its width sets the scale. */
export function drawBoard(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const u = size / BOARD_SIZE;

  ctx.fillStyle = COMBI.ink;
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, 0, 0, size, size, u);

  drawCenter(ctx, u, size);
  BOARD.forEach((sq, i) => drawSquare(ctx, sq, i, u, size));

  ctx.strokeStyle = COMBI.yellow;
  ctx.lineWidth = 0.022 * u;
  ctx.beginPath();
  ctx.roundRect(0.022 * u, 0.022 * u, size - 0.044 * u, size - 0.044 * u, 0.06 * u);
  ctx.stroke();
}

function font(px: number, weight = 800, stretch = "condensed"): string {
  return `${stretch} ${weight} ${Math.round(px)}px ${FONT}`;
}

function speckle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number): void {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 256;
  const t = tile.getContext("2d");
  if (!t) return;
  for (let i = 0; i < 1400; i++) {
    t.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.22)";
    const s = 1 + Math.random() * 2;
    t.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;
  pattern.setTransform(new DOMMatrix().scale(Math.max(1, u / 250)));
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  maxLines: number,
  maxPx: number,
  minPx: number,
  weight = 800,
  stretch = "condensed",
): { lines: string[]; px: number } {
  let px = maxPx;
  for (; px > minPx; px -= maxPx * 0.04) {
    ctx.font = font(px, weight, stretch);
    const lines = wrap(ctx, text, width);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= width)) return { lines, px };
  }
  ctx.font = font(minPx, weight, stretch);
  return { lines: wrap(ctx, text, width), px: minPx };
}

function drawLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number): void {
  lines.forEach((line, n) => ctx.fillText(line, x, y + n * lineHeight));
}

function plate(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, fill: string): void {
  const m = 0.035 * u;
  ctx.beginPath();
  ctx.roundRect(m, m, w - 2 * m, h - 2 * m, 0.075 * u);
  ctx.fillStyle = fill;
  ctx.fill();
}

function plateBorder(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, color: string): void {
  const m = 0.085 * u;
  ctx.beginPath();
  ctx.roundRect(m, m, w - 2 * m, h - 2 * m, 0.045 * u);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.02 * u;
  ctx.stroke();
}

function chip(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, u: number, maxW: number): void {
  const h = 0.3 * u;
  const { px } = fit(ctx, text, maxW - 0.2 * u, 1, 0.21 * u, 0.1 * u, 800, "normal");
  ctx.font = font(px, 800, "normal");
  const w = Math.min(maxW, ctx.measureText(text).width + 0.26 * u);
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 0.06 * u);
  ctx.fillStyle = COMBI.black;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,198,26,0.4)";
  ctx.lineWidth = 0.012 * u;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2 + 0.03 * u, cy - h / 2 + 0.03 * u, w - 0.06 * u, h - 0.06 * u, 0.04 * u);
  ctx.stroke();
  ctx.fillStyle = COMBI.yellow;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + px * 0.04);
}

function drawSquare(ctx: CanvasRenderingContext2D, sq: Square, i: number, u: number, size: number): void {
  const k = i % 10;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((Math.floor(i / 10) * Math.PI) / 2);

  const x0 = k === 0 ? INNER : 4.5 - k;
  const w = (k === 0 ? 2 : 1) * u;
  const h = 2 * u;
  ctx.translate(x0 * u, INNER * u);

  if (k === 0) {
    drawCorner(ctx, sq, u);
    ctx.restore();
    return;
  }

  plate(ctx, w, h, u, COMBI.plate);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0.035 * u, 0.035 * u, w - 0.07 * u, h - 0.07 * u, 0.075 * u);
  ctx.clip();
  bandFill(ctx, sq, u, w);
  ctx.fillStyle = COMBI.black;
  ctx.fillRect(0, BAND * u, w, 0.028 * u);
  ctx.restore();
  plateBorder(ctx, w, h, u, "rgba(20,22,27,0.9)");

  const cx = w / 2;
  const textWidth = 0.8 * u;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COMBI.plateInk;
  const top = (BAND + 0.1) * u;

  if (sq.kind === "street") {
    const { lines, px } = fit(ctx, sq.name, textWidth, 3, 0.21 * u, 0.13 * u);
    ctx.fillStyle = COMBI.plateInk;
    ctx.font = font(px);
    drawLines(ctx, lines, cx, top + px * 0.86, px * 1.02);
    if (sq.city) {
      ctx.fillStyle = COMBI.plateMuted;
      ctx.font = font(0.13 * u, 700, "normal");
      ctx.fillText(sq.city.toUpperCase(), cx, top + px * 1.02 * lines.length + 0.1 * u);
    }
  } else {
    const { lines, px } = fit(ctx, sq.name, textWidth, 3, 0.18 * u, 0.12 * u);
    ctx.font = font(px);
    drawLines(ctx, lines, cx, top + px * 0.86, px * 1.02);
    const name = ICONS[sq.name];
    if (name) drawIcon(ctx, name, cx, (sq.kind === "card" ? 1.26 : 1.2) * u, 0.25 * u);
  }

  const price = "price" in sq ? money(sq.price) : sq.kind === "tax" ? `Paga ${money(sq.amount)}` : "";
  if (price) chip(ctx, price, cx, 1.67 * u, u, 0.88 * u);
  ctx.restore();
}

const CORNERS: Record<string, { title: string; note: string; icon: IconName; field: string; ink: string }> = {
  salida: {
    title: "SALIDA",
    note: `Cobra ${money(200)} al pasar`,
    icon: "flag",
    field: COMBI.yellow,
    ink: COMBI.black,
  },
  jail: { title: "PENAL", note: "o solo de visita", icon: "bars", field: COMBI.plate, ink: COMBI.plateInk },
  parking: {
    title: "PARQUE KENNEDY",
    note: "descanso con los gatos",
    icon: "cat",
    field: GROUP_COLORS.verde,
    ink: COMBI.black,
  },
  goToJail: { title: "¡AL PENAL!", note: "sin pasar por Salida", icon: "siren", field: COMBI.red, ink: COMBI.plate },
};

function drawCorner(ctx: CanvasRenderingContext2D, sq: Square, u: number): void {
  const c = CORNERS[sq.kind];
  if (!c) return;
  const side = 2 * u;
  plate(ctx, side, side, u, c.field);
  if (sq.kind === "jail") {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0.035 * u, 0.035 * u, side - 0.07 * u, side - 0.07 * u, 0.075 * u);
    ctx.roundRect(0.17 * u, 0.17 * u, side - 0.34 * u, side - 0.34 * u, 0.04 * u);
    ctx.clip("evenodd");
    hazard(ctx, 0, 0, side, side, 0.12 * u);
    ctx.restore();
  }
  plateBorder(ctx, side, side, u, sq.kind === "salida" ? COMBI.black : "rgba(8,9,12,0.95)");

  ctx.save();
  ctx.translate(side / 2, side / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  drawIcon(ctx, c.icon, 0, -0.38 * u, 0.36 * u);
  const long = c.title.length > 8;
  const { px } = fit(ctx, c.title, 1.5 * u, 1, long ? 0.26 * u : 0.34 * u, 0.18 * u);
  ctx.font = font(px);
  ctx.fillStyle = c.ink;
  ctx.fillText(c.title, 0, 0.25 * u);
  chip(ctx, c.note, 0, 0.6 * u, u, 1.3 * u);
  ctx.restore();
}

function chichaText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number): void {
  ctx.font = font(px);
  const top = y - px * 0.38;
  const height = px * 0.76;
  const bands = ctx.createLinearGradient(0, top, 0, top + height);
  CHICHA.forEach((color, n) => {
    bands.addColorStop(n / CHICHA.length, color);
    bands.addColorStop((n + 1) / CHICHA.length - 0.001, color);
  });
  ctx.lineJoin = "round";
  ctx.lineWidth = px * 0.12;
  ctx.strokeStyle = COMBI.black;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = bands;
  ctx.fillText(text, x, y);
}

const RING = 3.95;
const ISLAND = 2.8;
const INNER_LINE = ISLAND + 0.3;
const LANE_LINE = (INNER_LINE + RING - 0.07) / 2;

function drawCenter(ctx: CanvasRenderingContext2D, u: number, size: number): void {
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const half = (HALF - 2) * u;

  ctx.fillStyle = STREET.sidewalk;
  ctx.fillRect(-half + 0.03 * u, -half + 0.03 * u, 2 * half - 0.06 * u, 2 * half - 0.06 * u);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 0.012 * u;
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  for (let g = -4; g <= 4; g++) {
    ctx.beginPath();
    ctx.moveTo(g * u, -half);
    ctx.lineTo(g * u, half);
    ctx.moveTo(-half, g * u);
    ctx.lineTo(half, g * u);
    ctx.stroke();
  }

  ctx.fillStyle = STREET.asphalt;
  ctx.beginPath();
  ctx.arc(0, 0, RING * u, 0, Math.PI * 2);
  ctx.fill();
  for (let side = 0; side < 4; side++) {
    ctx.save();
    ctx.rotate((side * Math.PI) / 2);
    ctx.fillStyle = STREET.asphalt;
    ctx.fillRect(-1.05 * u, 3.4 * u, 2.1 * u, (half / u - 3.4) * u + 0.01 * u);
    ctx.fillStyle = COMBI.yellow;
    ctx.fillRect(-0.03 * u, 3.75 * u, 0.06 * u, 0.6 * u);
    ctx.fillStyle = COMBI.plate;
    for (let s = -4; s <= 4; s++) {
      if (s % 2 === 0) ctx.fillRect(s * 0.2 * u - 0.075 * u, 4.07 * u, 0.15 * u, 0.32 * u);
    }
    ctx.fillRect(-1.05 * u, 3.98 * u, 0.025 * u, 0.5 * u);
    ctx.fillRect(1.025 * u, 3.98 * u, 0.025 * u, 0.5 * u);
    ctx.restore();
  }
  speckle(ctx, -half, -half, 2 * half, 2 * half, u * 0.6);

  ctx.lineCap = "butt";
  ctx.strokeStyle = COMBI.plate;
  ctx.lineWidth = 0.045 * u;
  ctx.beginPath();
  ctx.arc(0, 0, (RING - 0.07) * u, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COMBI.yellow;
  ctx.beginPath();
  ctx.arc(0, 0, INNER_LINE * u, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COMBI.plate;
  ctx.setLineDash([0.3 * u, 0.26 * u]);
  ctx.beginPath();
  ctx.arc(0, 0, LANE_LINE * u, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 0.06 * u;
  ctx.lineJoin = "miter";
  for (let n = 0; n < 12; n++) {
    ctx.save();
    ctx.rotate((n * Math.PI) / 6 + Math.PI / 12);
    ctx.translate(((LANE_LINE + RING - 0.07) / 2) * u, 0);
    ctx.beginPath();
    ctx.moveTo(-0.08 * u, -0.13 * u);
    ctx.lineTo(0.08 * u, 0);
    ctx.lineTo(-0.08 * u, 0.13 * u);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = COMBI.black;
  ctx.beginPath();
  ctx.arc(0, 0, ISLAND * u, 0, Math.PI * 2);
  ctx.fill();
  const kerb = 48;
  for (let n = 0; n < kerb; n++) {
    ctx.beginPath();
    ctx.arc(0, 0, (ISLAND + 0.1) * u, (n * 2 * Math.PI) / kerb, ((n + 1) * 2 * Math.PI) / kerb);
    ctx.strokeStyle = n % 2 ? COMBI.ink3 : COMBI.plate;
    ctx.lineWidth = 0.16 * u;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(246,241,226,0.3)";
  ctx.lineWidth = 0.02 * u;
  ctx.beginPath();
  ctx.arc(0, 0, (ISLAND - 0.16) * u, 0, Math.PI * 2);
  ctx.stroke();

  ctx.rotate(-Math.PI / 4);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const { px } = fit(ctx, "CHOLOPOLIS", 4.9 * u, 1, 1.4 * u, 0.5 * u);
  chichaText(ctx, "CHOLOPOLIS", 0, -0.22 * u, px);
  ctx.fillStyle = COMBI.plate;
  ctx.font = font(0.26 * u, 600, "normal");
  ctx.fillText("el juego de las avenidas del Perú", 0, 0.72 * u);
  ctx.restore();
  ctx.lineCap = "round";
}
