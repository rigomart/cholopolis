import { DurableObject } from "cloudflare:workers";

import { MAX_PLAYERS } from "../shared/board.ts";
import {
  act,
  addPlayer,
  autoPlay,
  cleanName,
  canDragDice,
  createGame,
  debtors,
  findPlayer,
  GameError,
  type GameState,
  removePlayer,
  restoreGame,
  syncPresence,
  toPublic,
} from "../shared/game.ts";
import { MAX_MESSAGE_BYTES, parseClientMessage, type ServerMessage } from "../shared/protocol.ts";
import { MessageBudget } from "./rateLimit.ts";

interface Attachment {
  token: string;
  playerId: string | null;
  name: string | null;
}

/** Time to act when it's your move. */
const TURN_MS = 60_000;
/** Time before the table plays for someone who is disconnected. */
const AWAY_MS = 10_000;
/** An abandoned table forgets everything after this long. */
const EXPIRE_MS = 24 * 60 * 60_000;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

const rng = () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;

/**
 * One game table. Holds the authoritative game state, applies every player's action through the
 * shared rules, and pushes the new state to every open socket. Sockets use the hibernation API,
 * so an idle table costs nothing; state lives in storage for when the object wakes up again.
 */
export class Table extends DurableObject<Env> {
  private game: GameState = createGame();
  /** Browser token → player id, so a reload or reconnect gets the same seat back. */
  private tokens: Record<string, string> = {};
  private room = "";
  /** What the current deadline is waiting for; a new value restarts the clock. */
  private waitingOn = "";
  private reportedOpen: boolean | null = null;
  private readonly actions = new MessageBudget(RATE_LIMIT, RATE_WINDOW_MS);
  private readonly drags = new MessageBudget(80, RATE_WINDOW_MS);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<GameState>("game");
      this.game = saved ? restoreGame(saved) : createGame();
      this.tokens = (await ctx.storage.get<Record<string, string>>("tokens")) ?? {};
      this.room = (await ctx.storage.get<string>("room")) ?? "";
      this.waitingOn = (await ctx.storage.get<string>("waitingOn")) ?? "";
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    if (!TOKEN_PATTERN.test(token)) return new Response("Token inválido", { status: 400 });
    if (!this.room) {
      this.room = url.pathname.split("/").pop() ?? "";
      await this.ctx.storage.put("room", this.room);
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const known = this.tokens[token];
    const attachment: Attachment = {
      token,
      playerId: findPlayer(this.game, known) ? (known ?? null) : null,
      name: null,
    };
    server.serializeAttachment(attachment);
    await this.commit(() => {});
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return;
    const msg = parseClientMessage(raw);
    if (msg?.type === "outdated") return;
    if (msg?.type === "diceHold") {
      if (!this.drags.allows(ws)) return;
    } else if (!this.actions.allows(ws)) {
      return this.send(ws, { type: "error", message: "Más despacio, por favor." });
    }
    if (!msg) return this.send(ws, { type: "error", message: "Mensaje inválido." });
    const att = ws.deserializeAttachment() as Attachment;

    try {
      switch (msg.type) {
        case "join": {
          const name = cleanName(msg.name);
          att.name = name;
          const seated = findPlayer(this.game, att.playerId);
          const seatFree = this.game.players.length < MAX_PLAYERS || this.game.players.some((p) => !p.connected);
          if (!seated && this.game.phase === "lobby" && seatFree) {
            att.playerId = crypto.randomUUID();
            this.tokens[att.token] = att.playerId;
            await this.ctx.storage.put("tokens", this.tokens);
          }
          // Seat the socket first so the new player counts as present in this same commit.
          this.setAttachment(att);
          const id = att.playerId;
          return await this.commit((g) => {
            if (id && g.phase === "lobby" && !findPlayer(g, id)) addPlayer(g, id, name);
          });
        }
        case "leave": {
          const id = att.playerId;
          if (!id || this.game.phase !== "lobby") return;
          att.playerId = null;
          this.setAttachment(att);
          delete this.tokens[att.token];
          await this.ctx.storage.put("tokens", this.tokens);
          return await this.commit((g) => removePlayer(g, id));
        }
        case "diceHold": {
          if (!canDragDice(this.game, att.playerId, msg.rollId)) return;
          for (const other of this.sockets(ws)) {
            this.send(other, {
              type: "diceHold",
              playerId: att.playerId as string,
              rollId: msg.rollId,
              hold: msg.hold,
            });
          }
          return;
        }
        case "action": {
          const id = att.playerId;
          if (!id) return this.send(ws, { type: "error", message: "Estás mirando esta partida." });
          return await this.commit((g) => act(g, id, msg.action, rng));
        }
      }
    } catch (error) {
      if (!(error instanceof GameError)) throw error;
      this.send(ws, { type: "error", message: error.message });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed by the runtime.
    }
    await this.commit(() => {}, ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.commit(() => {}, ws);
  }

  async alarm(): Promise<void> {
    const sockets = this.sockets();
    if (sockets.length === 0) {
      await this.ctx.storage.deleteAll();
      await this.report(false);
      this.game = createGame();
      this.tokens = {};
      this.room = "";
      this.waitingOn = "";
      return;
    }
    const deadline = this.game.deadline;
    if (this.game.phase === "playing" && deadline !== null && Date.now() >= deadline - 250) {
      this.waitingOn = "";
      await this.commit((g) => autoPlay(g, rng));
    } else {
      await this.schedule();
    }
  }

  // ---------------------------------------------------------------- internals

  private sockets(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && ws.readyState === WebSocket.OPEN);
  }

  private setAttachment(att: Attachment): void {
    // Every tab with this token shares the seat.
    for (const ws of this.sockets()) {
      const other = ws.deserializeAttachment() as Attachment;
      if (other.token === att.token) ws.serializeAttachment({ ...other, playerId: att.playerId, name: att.name });
    }
  }

  /**
   * Applies `change` to a copy of the game, so a rule violation halfway through leaves nothing
   * half-done, then saves, reschedules the turn clock, and broadcasts.
   */
  private async commit(change: (g: GameState) => void, closing?: WebSocket) {
    const draft = structuredClone(this.game);
    const sockets = this.sockets(closing);
    const present = new Set(sockets.map((ws) => (ws.deserializeAttachment() as Attachment).playerId ?? ""));
    syncPresence(draft, present);
    change(draft);
    syncPresence(draft, present);
    this.game = draft;

    this.updateDeadline(present);
    await this.ctx.storage.put({ game: this.game, waitingOn: this.waitingOn });
    await this.schedule(closing);
    this.broadcast(sockets);
    await this.report(this.game.phase === "lobby" && present.size > 0 && this.game.players.length < MAX_PLAYERS);
  }

  /**
   * Restarts the turn clock only when the game moves on: a new turn or stage, a roll, a change in
   * who owes money, or the awaited player leaving or coming back. Other actions never buy time,
   * so nobody can hold the table by sending no-op actions.
   */
  private updateDeadline(present: Set<string>): void {
    const g = this.game;
    if (g.phase !== "playing" || !g.turn) {
      g.deadline = null;
      this.waitingOn = "";
      return;
    }
    const owing = debtors(g).map((p) => p.id);
    const waitingFor = owing.length > 0 ? owing : [g.turn.playerId];
    const here = waitingFor.some((id) => present.has(id));
    const key = `${g.turn.playerId}:${g.turn.stage}:${g.rollId}:${owing.join(",")}:${here}`;
    if (key === this.waitingOn && g.deadline !== null) return;
    this.waitingOn = key;
    g.deadline = Date.now() + (here ? TURN_MS : AWAY_MS);
  }

  private async schedule(closing?: WebSocket): Promise<void> {
    const players = this.game.players.filter((p) => p.connected).length;
    if (this.sockets(closing).length === 0) {
      await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
    } else if (this.game.deadline !== null && players > 0) {
      await this.ctx.storage.setAlarm(this.game.deadline);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private broadcast(sockets: WebSocket[]): void {
    const state = toPublic(this.game);
    const spectators: string[] = [];
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as Attachment;
      if (att.name && !findPlayer(state, att.playerId)) spectators.push(att.name);
    }
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as Attachment;
      const you = findPlayer(state, att.playerId) ? att.playerId : null;
      this.send(ws, { type: "state", state, you, spectators });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket closed between listing and sending; its close handler will tidy up.
    }
  }

  /** Tells the lobby whether newcomers can sit here. Open tables re-report so the lobby keeps them fresh. */
  private async report(open: boolean): Promise<void> {
    if (!this.room || (!open && this.reportedOpen === false)) return;
    await this.env.LOBBY.get(this.env.LOBBY.idFromName("main")).report(this.room, open);
    this.reportedOpen = open;
  }
}
