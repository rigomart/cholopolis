import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type { PublicState } from "../../shared/game.ts";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.ts";
import { browserToken } from "./session.ts";

export type Status = "connecting" | "open" | "reconnecting";

export interface Table {
  status: Status;
  state: PublicState | null;
  you: string | null;
  spectators: string[];
  error: { id: number; message: string } | null;
  /** The latest live dice-shake notice from another player. */
  shake: { id: number; playerId: string; on: boolean } | null;
  send: (msg: ClientMessage) => void;
}

const PING_MS = 25_000;

/** Keeps a socket to one table open, rejoining after drops, and exposes its latest state. */
export function useTable(room: string, name: string): Table {
  const [status, setStatus] = useState<Status>("connecting");
  const [state, setState] = useState<PublicState | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [spectators, setSpectators] = useState<string[]>([]);
  const [error, setError] = useState<Table["error"]>(null);
  const [shake, setShake] = useState<Table["shake"]>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${location.host}/ws/${room}?token=${browserToken()}`);
      socket.current = ws;
      ws.addEventListener("open", () => {
        attempt = 0;
        setStatus("open");
        ws.send(JSON.stringify({ type: "join", name } satisfies ClientMessage));
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
      });
      ws.addEventListener("message", (event) => {
        if (event.data === "pong") return;
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        if (msg.type === "state") {
          setState(msg.state);
          setYou(msg.you);
          setSpectators(msg.spectators);
        } else if (msg.type === "shake") {
          setShake({ id: Date.now(), playerId: msg.playerId, on: msg.on });
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
  }, [room, name]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else setError({ id: Date.now(), message: "Sin conexión. Reconectando…" });
  }, []);

  return { status, state, you, spectators, error, shake, send };
}
