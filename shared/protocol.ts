import { type DiceHold, parseDiceHold, parseDiceToss } from "./dice.ts";
import type { Action, PublicState, TradeSide } from "./game.ts";
import { PIECES } from "./pieces.ts";

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "leave" }
  | { type: "action"; action: Action }
  | { type: "diceHold"; rollId: number; hold: DiceHold | null }
  /** Sent only by tabs still running an older client; ignored without a reply. */
  | { type: "outdated" };

export type ServerMessage =
  | {
      type: "state";
      state: PublicState;
      you: string | null;
      spectators: string[];
      /** The server's clock when sent, so clients can read `state.deadline` against their own. */
      now: number;
    }
  | { type: "error"; message: string }
  | { type: "diceHold"; playerId: string; rollId: number; hold: DiceHold | null };

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
    case "rematch":
    case "buy":
    case "decline":
    case "endTurn":
    case "payJailFine":
    case "useJailCard":
    case "bankrupt":
    case "addBot":
      return { type: v.type };
    case "removeBot":
      return typeof v.player === "string" ? { type: "removeBot", player: v.player } : null;
    case "roll": {
      if (v.rollId !== undefined && !isCount(v.rollId)) return null;
      // The toss is cosmetic, so one that doesn't parse (or an older client's `toss`) is dropped
      // and the roll still goes ahead.
      const diceToss = parseDiceToss(v.diceToss);
      return {
        type: "roll",
        ...(diceToss ? { diceToss } : {}),
        ...(v.rollId === undefined ? {} : { rollId: v.rollId as number }),
      };
    }
    case "setTimeLimit":
      return v.minutes === null || isCount(v.minutes) ? { type: "setTimeLimit", minutes: v.minutes } : null;
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
  if (v.type === "diceHold" && isCount(v.rollId)) {
    const hold = v.hold === null ? null : parseDiceHold(v.hold);
    if (v.hold !== null && !hold) return null;
    return { type: "diceHold", rollId: v.rollId, hold };
  }
  // The hold message before `diceHold`, in a shape this table no longer relays.
  if (v.type === "diceDrag") return { type: "outdated" };
  if (v.type === "action") {
    const action = parseAction(v.action);
    return action ? { type: "action", action } : null;
  }
  return null;
}
