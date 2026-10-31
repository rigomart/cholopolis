import { findPlayer, money, type Player, PLAYER_COLORS, type PublicState, ranking } from "../../shared/game.ts";
import { highlights } from "../../shared/highlights.ts";
import { CHICHA, FONT, INK } from "./scene/boardTexture.ts";
import { pieceThumbnail } from "./scene/thumbnails.ts";
import { PAWN_PATH } from "./ui/bits.tsx";

export const WIDTH = 1080;
export const HEIGHT = 1350;
const BOARD_HEIGHT = 720;
const SITE = "cholopolis.rigos.dev";
const CREAM = "#fff6e5";
const CYAN = "#19e3ff";
const YELLOW = CHICHA[2];

type Snapshot = (width: number, height: number) => HTMLCanvasElement;

let snapshot: Snapshot | null = null;

/** Pass null to unregister; with none registered (no WebGL) the postcard has no board photo. */
export function registerBoardSnapshot(fn: Snapshot | null): void {
  snapshot = fn;
}

export async function postcard(state: PublicState): Promise<Blob> {
  await Promise.all([document.fonts.load(font(800, 100)), document.fonts.load(font(600, 40, "normal"))]);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  drawPostcard(ctx, state, boardImage(), await winnerThumbnail(state));
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the postcard."))), "image/png"),
  );
}

function boardImage(): HTMLCanvasElement | null {
  try {
    return snapshot?.(WIDTH, BOARD_HEIGHT) ?? null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

/** Opens the share sheet with the image where the browser can, or else downloads it. */
export async function sharePostcard(blob: Blob): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], "cholopolis-postal.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `¿Te animas a una partida? https://${SITE}` });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Refused (no user gesture, policy): the download still works.
      console.error(error);
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

function font(weight: number, px: number, stretch: "condensed" | "normal" = "condensed"): string {
  return `${stretch} ${weight} ${px}px ${FONT}`;
}

const LAYOUT = {
  photo: { wordmark: 132, title: 950, subtitle: 1008, stats: 1088, statPx: 40 },
  plain: { wordmark: 330, title: 600, subtitle: 665, stats: 800, statPx: 48 },
};
const PHOTO_TOP = 150;

function drawPostcard(
  ctx: CanvasRenderingContext2D,
  state: PublicState,
  board: HTMLCanvasElement | null,
  thumb: HTMLImageElement | null,
): void {
  const at = board ? LAYOUT.photo : LAYOUT.plain;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (board) {
    ctx.drawImage(board, 0, PHOTO_TOP);
    inkFade(ctx, PHOTO_TOP, PHOTO_TOP + 100, 1, 0);
    inkFade(ctx, PHOTO_TOP + BOARD_HEIGHT - 140, PHOTO_TOP + BOARD_HEIGHT, 0, 1);
  }
  stripes(ctx, 0, 14);
  stripes(ctx, HEIGHT - 14, 14);
  wordmark(ctx, WIDTH / 2, at.wordmark, 140);
  drawWinner(ctx, state, thumb, at.title, at.subtitle);
  drawHighlights(ctx, state, at.stats, at.statPx);

  ctx.font = font(800, 44);
  ctx.fillStyle = YELLOW;
  ctx.fillText(SITE, WIDTH / 2, HEIGHT - 48);
}

const inkHex = (alpha: number) =>
  INK +
  Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");

function inkFade(ctx: CanvasRenderingContext2D, from: number, to: number, fromAlpha: number, toAlpha: number): void {
  const g = ctx.createLinearGradient(0, from, 0, to);
  g.addColorStop(0, inkHex(fromAlpha));
  g.addColorStop(1, inkHex(toAlpha));
  ctx.fillStyle = g;
  ctx.fillRect(0, from, WIDTH, to - from);
}

function stripes(ctx: CanvasRenderingContext2D, y: number, height: number): void {
  const band = WIDTH / CHICHA.length;
  CHICHA.forEach((color, n) => {
    ctx.fillStyle = color;
    ctx.fillRect(n * band, y, band + 1, height);
  });
}

function wordmark(ctx: CanvasRenderingContext2D, x: number, y: number, px: number): void {
  ctx.font = font(800, px);
  ctx.fillStyle = CYAN;
  ctx.fillText("CHOLOPOLIS", x + px * 0.045, y + px * 0.06);
  const top = y - px * 0.72;
  const bands = ctx.createLinearGradient(0, top, 0, y);
  const stops = [0, 0.3, 0.5, 0.7, 1];
  CHICHA.forEach((color, n) => {
    bands.addColorStop(stops[n] ?? 0, color);
    bands.addColorStop((stops[n + 1] ?? 1) - 0.001, color);
  });
  ctx.fillStyle = bands;
  ctx.fillText("CHOLOPOLIS", x, y);
}

const THUMB_SIZE = 130;
const THUMB_GAP = -6;

function drawWinner(
  ctx: CanvasRenderingContext2D,
  state: PublicState,
  thumb: HTMLImageElement | null,
  baseline: number,
  subtitleBaseline: number,
): void {
  const winner = findPlayer(state, state.winnerId);
  const title = winner ? `¡Ganó ${winner.name}!` : "¡Se acabó la partida!";
  const side = thumb ? THUMB_SIZE + THUMB_GAP : 0;
  const px = fitFont(ctx, title, 96, WIDTH - 120 - side);
  ctx.font = font(800, px);
  const width = ctx.measureText(title).width;
  const left = (WIDTH - width - side) / 2 + side;
  if (thumb) ctx.drawImage(thumb, left - side, baseline - THUMB_SIZE * 0.82, THUMB_SIZE, THUMB_SIZE);
  ctx.textAlign = "left";
  ctx.fillStyle = CREAM;
  ctx.fillText(title, left, baseline);
  ctx.textAlign = "center";
  if (winner) {
    ctx.beginPath();
    ctx.roundRect(left, baseline + 14, width, 12, 6);
    fillOutlined(ctx, PLAYER_COLORS[winner.color]);
  }

  const worth = ranking(state).find((r) => r.player.id === winner?.id)?.worth;
  const subtitle = !state.endedByTime
    ? "Dejó a todos en quiebra."
    : worth === undefined
      ? "Se acabó el tiempo."
      : `Se acabó el tiempo y terminó con ${money(worth)} de patrimonio.`;
  ctx.font = font(600, 34, "normal");
  ctx.fillStyle = "rgba(255,246,229,0.72)";
  ctx.fillText(subtitle, WIDTH / 2, subtitleBaseline);
}

async function winnerThumbnail(state: PublicState): Promise<HTMLImageElement | null> {
  const winner = findPlayer(state, state.winnerId);
  if (!winner) return null;
  const img = new Image();
  img.src = pieceThumbnail(winner.piece, winner.color) ?? flatPawn(winner);
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

function flatPawn(p: Player): string {
  const fill = PLAYER_COLORS[p.color] ?? "#fff";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -1 24 28"><path d="${PAWN_PATH}" fill="${fill}" stroke="${CREAM}" stroke-width="1.4"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function drawHighlights(ctx: CanvasRenderingContext2D, state: PublicState, top: number, px: number): void {
  const lines = highlights(state);
  const left = 110;
  const maxWidth = WIDTH - left - 70;
  let y = top;
  for (const h of lines) {
    const p = findPlayer(state, h.playerId);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(left - 34, y - px * 0.34, px * 0.28, 0, Math.PI * 2);
    fillOutlined(ctx, PLAYER_COLORS[p.color]);
    y = richText(ctx, p.name, h.text, left, y, px, maxWidth) + px * 0.55;
  }
}

/** Bold name then text, wrapped at `maxWidth`; returns the baseline below the last line. */
function richText(
  ctx: CanvasRenderingContext2D,
  name: string,
  rest: string,
  x: number,
  y: number,
  px: number,
  maxWidth: number,
): number {
  ctx.textAlign = "left";
  const words: { text: string; bold: boolean }[] = [
    ...name.split(" ").map((text) => ({ text, bold: true })),
    ...rest.split(" ").map((text) => ({ text, bold: false })),
  ];
  const lineHeight = px * 1.18;
  let cx = x;
  for (const w of words) {
    ctx.font = w.bold ? font(800, px) : font(600, px, "normal");
    const width = ctx.measureText(w.text).width;
    if (cx > x && cx + width > x + maxWidth) {
      cx = x;
      y += lineHeight;
    }
    ctx.fillStyle = w.bold ? YELLOW : CREAM;
    ctx.fillText(w.text, cx, y);
    cx += width + ctx.measureText(" ").width;
  }
  ctx.textAlign = "center";
  return y + lineHeight;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, px: number, maxWidth: number): number {
  ctx.font = font(800, px);
  const width = ctx.measureText(text).width;
  return width > maxWidth ? Math.floor((px * maxWidth) / width) : px;
}

/** Fills the current path in a player's color with a cream outline, which the dark pawn color needs on the ink. */
function fillOutlined(ctx: CanvasRenderingContext2D, color: string | undefined): void {
  ctx.fillStyle = color ?? CREAM;
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
}
