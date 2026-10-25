import { DurableObject } from "cloudflare:workers";

interface RoomInfo {
  open: boolean;
  /** False until the table itself has reported; until then the room is only a handed-out id. */
  reported: boolean;
  at: number;
}

/** A handed-out room nobody connected to stops attracting newcomers after this long. */
const PENDING_MS = 2 * 60_000;
/** Tables report on every arrival and departure; one silent this long is assumed gone. */
const REPORTED_MS = 6 * 60 * 60_000;

const isFresh = (r: RoomInfo, now: number) => now - r.at < (r.reported ? REPORTED_MS : PENDING_MS);

export function newRoomId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => alphabet[b % alphabet.length]).join("");
}

/** Remembers which tables are waiting for players, so the home page can send newcomers there. */
export class Lobby extends DurableObject<Env> {
  private rooms: Record<string, RoomInfo> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.rooms = (await ctx.storage.get<Record<string, RoomInfo>>("rooms")) ?? {};
    });
  }

  async openRoom(): Promise<string> {
    const now = Date.now();
    const found = Object.entries(this.rooms).find(([, r]) => r.open && isFresh(r, now));
    if (found) return found[0];
    const id = newRoomId();
    this.rooms[id] = { open: true, reported: false, at: now };
    await this.save();
    return id;
  }

  newRoom(): string {
    return newRoomId();
  }

  async report(room: string, open: boolean): Promise<void> {
    if (open) this.rooms[room] = { open, reported: true, at: Date.now() };
    else delete this.rooms[room];
    await this.save();
  }

  private async save(): Promise<void> {
    const now = Date.now();
    for (const [id, r] of Object.entries(this.rooms)) {
      if (!isFresh(r, now)) delete this.rooms[id];
    }
    await this.ctx.storage.put("rooms", this.rooms);
  }
}
