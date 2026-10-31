import type { RankingPeriod, RankingResponse } from "../../shared/leaderboard.ts";
import { ROOM_PATTERN, TOKEN_HEADER } from "../../shared/protocol.ts";

const TOKEN_KEY = "cholopolis:token";
const NAME_KEY = "cholopolis:name";

/** A random id this browser keeps, so the table recognises a returning player. Not shown to anyone. */
export function browserToken(): string {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    token = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_");
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

export const savedName = () => localStorage.getItem(NAME_KEY) ?? "";
export const saveName = (name: string) => localStorage.setItem(NAME_KEY, name);

export function roomFromPath(): string | null {
  return /^\/mesa\/([a-z0-9]{6,12})\/?$/.exec(location.pathname)?.[1] ?? null;
}

/**
 * Reads a table code out of what a person typed or pasted: the bare code in any case, with stray
 * spaces, or a whole `/mesa/<code>` link. Null when it can't be a table code.
 */
export function parseRoomCode(input: string): string | null {
  const linked = /\/mesa\/([a-z0-9]{6,12})(?![a-z0-9])/i.exec(input)?.[1];
  const code = (linked ?? input).replace(/\s+/g, "").toLowerCase();
  return ROOM_PATTERN.test(code) ? code : null;
}

export function goToRoom(room: string | null): void {
  history.pushState(null, "", room ? `/mesa/${room}` : "/");
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new Error("No hay conexión. Inténtalo otra vez.");
  }
}

async function requestRoom(path: string): Promise<string> {
  const res = await call(path, { method: "POST" });
  if (!res.ok) throw new Error(`No se pudo conseguir una mesa (${res.status}).`);
  const { room } = (await res.json()) as { room: string };
  return room;
}

/** Whether a table with this code has ever been opened (and hasn't since expired). */
export async function roomExists(room: string): Promise<boolean> {
  const res = await call(`/api/mesa/${room}`);
  if (!res.ok) throw new Error(`No se pudo revisar la mesa (${res.status}).`);
  return ((await res.json()) as { exists: boolean }).exists;
}

export const findOpenRoom = () => requestRoom("/api/mesa-abierta");
export const createRoom = () => requestRoom("/api/mesa-nueva");

/** The ranking for a period, with your own row. `fresh` bypasses the browser's HTTP cache. */
export async function fetchRanking(period: RankingPeriod, fresh = false): Promise<RankingResponse> {
  const res = await call(`/api/ranking?period=${period}`, {
    headers: { [TOKEN_HEADER]: browserToken() },
    cache: fresh ? "no-cache" : "default",
  });
  if (!res.ok) throw new Error(`No se pudo cargar el ranking (${res.status}).`);
  return (await res.json()) as RankingResponse;
}
