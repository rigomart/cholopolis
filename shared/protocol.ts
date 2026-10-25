import { type DiceDrag, parseDiceDrag, parseDiceToss } from "./dice.ts";
import type { Action, PublicState, TradeSide } from "./game.ts";
import { PIECES } from "./pieces.ts";

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "leave" }
  | { type: "action"; action: Action }
  | { type: "diceDrag"; rollId: number; drag: DiceDrag | null };

export type ServerMessage =
  | { type: "state"; state: PublicState; you: string | null; spectators: string[] }
  | { type: "error"; message: string }
  | { type: "diceDrag"; playerId: string; rollId: number; drag: DiceDrag | null };

export const ROOM_PATTERN = /^[a-z0-9]{6,12}$/;
export const MAX_MESSAGE_BYTES = 4096;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isSquare = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 40;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1e7;

function parseSide(v: unknown): TradeSide | null {
  if (!isObject(v) || !Array.isArray(v.squares) || !v.squares.every(isSquare)) return null;
  if (v.squares.length > 28 || !isCount(v.cash) || !isCount(v.jailCards)) return null;
  return { squares: v.squares, cash: v.cash, jailCards: v.jailCards };
}

function parseAction(v: unknown): Action | null {
  if (!isObject(v)) return null;
  switch (v.type) {
    case "start":
    case "buy":
    case "decline":
    case "endTurn":
    case "payJailFine":
    case "useJailCard":
    case "bankrupt":
      return { type: v.type };
    case "roll": {
      if (v.rollId !== undefined && !isCount(v.rollId)) return null;
      const toss = v.toss === undefined ? undefined : parseDiceToss(v.toss);
      if (toss === null) return null;
      return {
        type: "roll",
        ...(toss ? { toss } : {}),
        ...(v.rollId === undefined ? {} : { rollId: v.rollId as number }),
      };
    }
    case "choosePiece":
      return Number.isInteger(v.piece) && (v.piece as number) >= 0 && (v.piece as number) < PIECES.length
        ? { type: "choosePiece", piece: v.piece as number }
        : null;
    case "build":
    case "sell":
    case "mortgage":
    case "unmortgage":
      return isSquare(v.square) ? { type: v.type, square: v.square } : null;
    case "acceptTrade":
    case "rejectTrade":
    case "cancelTrade":
      return Number.isInteger(v.trade) ? { type: v.type, trade: v.trade as number } : null;
    case "proposeTrade": {
      const give = parseSide(v.give);
      const get = parseSide(v.get);
      if (typeof v.to !== "string" || !give || !get) return null;
      return { type: "proposeTrade", to: v.to, give, get };
    }
    default:
      return null;
  }
}

/** Validates the shape of an incoming message; the game rules validate the rest. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  if (v.type === "join" && typeof v.name === "string") return { type: "join", name: v.name };
  if (v.type === "leave") return { type: "leave" };
  if (v.type === "diceDrag" && isCount(v.rollId)) {
    const drag = v.drag === null ? null : parseDiceDrag(v.drag);
    if (v.drag !== null && !drag) return null;
    return { type: "diceDrag", rollId: v.rollId, drag };
  }
  if (v.type === "action") {
    const action = parseAction(v.action);
    return action ? { type: "action", action } : null;
  }
  return null;
}
