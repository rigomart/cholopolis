import { BOARD, GROUP_COLORS, type Square } from "../../../shared/board.ts";
import { money } from "../../../shared/game.ts";
import { BAND, BOARD_SIZE, HALF, INNER } from "./layout.ts";

export const FONT = "'Bricolage Grotesque Variable', system-ui, sans-serif";
export const INK = "#1b1240";
export const CHICHA = ["#ff2e88", "#ff7a1a", "#ffe500", "#2bff88"] as const;
const PAPER = "#d4efe4";
const CENTER = "#bfe6d5";

const ICONS: Record<string, string> = {
  "Línea 1 del Metro": "🚇",
  Metropolitano: "🚌",
  "Aeropuerto Jorge Chávez": "✈️",
  "Tren a Machu Picchu": "🚂",
  "Luz del Sur": "💡",
  Sedapal: "🚰",
  "Impuesto SUNAT": "🧾",
  "Arbitrios municipales": "🏛️",
  Suerte: "❓",
  "Caja Municipal": "🏦",
};

/** Paints the whole board face (squares, names, prices, the logo) onto a square canvas. */
export function drawBoard(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const u = size / BOARD_SIZE;

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = CENTER;
  ctx.fillRect(2 * u + 2, 2 * u + 2, 9 * u - 4, 9 * u - 4);

  BOARD.forEach((sq, i) => drawSquare(ctx, sq, i, u, size));
  drawCenter(ctx, u, size);
}

function font(px: number, weight = 800, stretch = "condensed"): string {
  return `${stretch} ${weight} ${Math.round(px)}px ${FONT}`;
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

function drawLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number): void {
  lines.forEach((line, n) => ctx.fillText(line, x, y + n * lineHeight));
}

function drawSquare(ctx: CanvasRenderingContext2D, sq: Square, i: number, u: number, size: number): void {
  const k = i % 10;
  const gap = Math.max(1, u * 0.012);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((Math.floor(i / 10) * Math.PI) / 2);

  const x0 = k === 0 ? INNER : 4.5 - k;
  const w = k === 0 ? 2 : 1;
  ctx.fillStyle = PAPER;
  ctx.fillRect(x0 * u + gap, INNER * u + gap, w * u - 2 * gap, 2 * u - 2 * gap);

  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (k === 0) {
    drawCorner(ctx, sq, u);
  } else {
    const cx = (5 - k) * u;
    const textWidth = 0.86 * u;
    if (sq.kind === "street") {
      ctx.fillStyle = GROUP_COLORS[sq.group];
      ctx.fillRect(x0 * u + gap, INNER * u + gap, u - 2 * gap, BAND * u);
      ctx.fillStyle = INK;
      ctx.font = font(0.15 * u);
      const lines = wrap(ctx, sq.name, textWidth);
      drawLines(ctx, lines, cx, (INNER + BAND + 0.2) * u, 0.155 * u);
      if (sq.city) {
        ctx.font = font(0.1 * u, 500, "normal");
        ctx.fillText(sq.city, cx, (INNER + BAND + 0.24 + lines.length * 0.155) * u);
      }
    } else {
      ctx.font = font(0.13 * u);
      const lines = wrap(ctx, sq.name, textWidth);
      drawLines(ctx, lines, cx, (INNER + 0.2) * u, 0.14 * u);
      ctx.font = `${Math.round(0.46 * u)}px ${FONT}`;
      ctx.fillText(ICONS[sq.name] ?? "", cx, (INNER + 1.05) * u);
    }
    const price = "price" in sq ? money(sq.price) : sq.kind === "tax" ? `Paga ${money(sq.amount)}` : "";
    if (price) {
      ctx.font = font(0.12 * u, 600, "normal");
      ctx.fillText(price, cx, (HALF - 0.2) * u);
    }
  }
  ctx.restore();
}

function drawCorner(ctx: CanvasRenderingContext2D, sq: Square, u: number): void {
  ctx.save();
  ctx.translate((INNER + 1) * u, (INNER + 1) * u);
  ctx.rotate(-Math.PI / 4);
  const [title, note, icon] =
    sq.kind === "salida"
      ? ["SALIDA", `Cobra ${money(200)} al pasar`, ""]
      : sq.kind === "jail"
        ? ["PENAL", "o solo de visita", "🚔"]
        : sq.kind === "parking"
          ? ["PARQUE KENNEDY", "descanso con los gatos", "🐈"]
          : ["¡AL PENAL!", "sin pasar por Salida", "👮"];

  if (sq.kind === "salida") {
    chichaText(ctx, title, 0, -0.1 * u, 0.62 * u);
    ctx.fillStyle = INK;
    ctx.font = font(0.15 * u, 600, "normal");
    ctx.fillText(note, 0, 0.42 * u);
  } else {
    ctx.font = `${Math.round(0.6 * u)}px ${FONT}`;
    ctx.fillText(icon, 0, -0.18 * u);
    ctx.font = font(sq.kind === "parking" ? 0.22 * u : 0.3 * u);
    ctx.fillText(title, 0, 0.36 * u);
    ctx.font = font(0.12 * u, 500, "normal");
    ctx.fillText(note, 0, 0.6 * u);
  }
  ctx.restore();
}

/** Text filled with hard-edged fluorescent bands and an ink outline, like a chicha poster. */
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
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = bands;
  ctx.fillText(text, x, y);
}

function drawCenter(ctx: CanvasRenderingContext2D, u: number, size: number): void {
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  drawPile(ctx, u, 0, -2.75 * u, CHICHA[1], "Suerte", "❓");
  drawPile(ctx, u, 0, 2.75 * u, "#38bdf8", "Caja Municipal", "🏦");

  chichaText(ctx, "CHOLOPOLIS", 0, 0, 1.55 * u);
  ctx.fillStyle = INK;
  ctx.font = font(0.3 * u, 600, "normal");
  ctx.fillText("el juego de las avenidas del Perú", 0, 1.0 * u);
  ctx.restore();
}

function drawPile(
  ctx: CanvasRenderingContext2D,
  u: number,
  x: number,
  y: number,
  color: string,
  label: string,
  icon: string,
) {
  const w = 2.6 * u;
  const h = 1.3 * u;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = INK;
  ctx.fillRect(-w / 2 + 0.06 * u, -h / 2 + 0.06 * u, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.03 * u;
  ctx.strokeRect(-w / 2 + 0.1 * u, -h / 2 + 0.1 * u, w - 0.2 * u, h - 0.2 * u);
  ctx.fillStyle = INK;
  ctx.font = `${Math.round(0.42 * u)}px ${FONT}`;
  ctx.fillText(icon, 0, -0.18 * u);
  ctx.font = font(0.3 * u);
  ctx.fillText(label, 0, 0.32 * u);
  ctx.restore();
}
