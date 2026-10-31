import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type { PublicState } from "../../shared/game.ts";
import { type ClientMessage, parseServerMessage, type ServerMessage } from "../../shared/protocol.ts";
import type { ReactionId } from "../../shared/reactions.ts";
import { browserToken } from "./session.ts";
import { type Bubbles, useReactions } from "./useReactions.ts";

export type Status = "connecting" | "open" | "reconnecting";

export interface Table {
  name: string;
  status: Status;
  state: PublicState | null;
  you: string | null;
  spectators: string[];
  error: { id: number; message: string } | null;
  diceHold: (Extract<ServerMessage, { type: "diceHold" }> & { id: number }) | null;
  send: (msg: ClientMessage) => void;
  reactions: { bubbles: Bubbles; cooling: boolean; react: (reaction: ReactionId) => void };
  /** The server's clock, as best this tab can tell; compare `state.deadline` against this. */
  serverNow: () => number;
}

const PING_MS = 25_000;

/** Keeps a socket to one table open, rejoining after drops, and exposes its latest state. */
export function useTable(room: string, name: string): Table {
  const [status, setStatus] = useState<Status>("connecting");
  const [state, setState] = useState<PublicState | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [spectators, setSpectators] = useState<string[]>([]);
  const [error, setError] = useState<Table["error"]>(null);
  const [diceHold, setDiceHold] = useState<Table["diceHold"]>(null);
  const socket = useRef<WebSocket | null>(null);
  const skew = useRef(0);
  const sendReaction = useCallback((reaction: ReactionId) => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "reaction", reaction } satisfies ClientMessage));
    return true;
  }, []);
  const { bubbles, cooling, show, react } = useReactions(you, sendReaction);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      // Each sample lands late by however long the message took, so the largest one is the best
      // guess. Start over on every connection in case this machine's clock was changed meanwhile.
      let bestSkew = -Infinity;
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${location.host}/ws/${room}?token=${browserToken()}&reactions=1`);
      socket.current = ws;
      ws.addEventListener("open", () => {
        attempt = 0;
        setStatus("open");
        ws.send(JSON.stringify({ type: "join", name } satisfies ClientMessage));
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
      });
      ws.addEventListener("message", (event) => {
        if (event.data === "pong") return;
        const msg = parseServerMessage(String(event.data));
        if (!msg) return;
        if (msg.type === "state") {
          // An older server omits `now`; keep the last estimate.
          if (Number.isFinite(msg.now)) {
            bestSkew = Math.max(bestSkew, msg.now - Date.now());
            skew.current = bestSkew;
          }
          setState(msg.state);
          setYou(msg.you);
          setSpectators(msg.spectators);
        } else if (msg.type === "diceHold") {
          setDiceHold({ ...msg, id: Date.now() });
        } else if (msg.type === "reaction") {
          show(msg.playerId, msg.reaction);
        } else {
          setError({ id: Date.now(), message: msg.message });
        }
      });
      ws.addEventListener("close", () => {
        clearInterval(ping);
        if (stopped) return;
        setStatus("reconnecting");
        retry = setTimeout(connect, Math.min(8000, 400 * 2 ** attempt++));
      });
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      socket.current?.close();
      socket.current = null;
    };
  }, [room, name, show]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else setError({ id: Date.now(), message: "Sin conexión. Reconectando…" });
  }, []);

  const serverNow = useCallback(() => Date.now() + skew.current, []);

  return {
    name,
    status,
    state,
    you,
    spectators,
    error,
    diceHold,
    send,
    reactions: { bubbles, cooling, react },
    serverNow,
  };
}
