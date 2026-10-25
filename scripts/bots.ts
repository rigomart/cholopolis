/**
 * Seats bots at a table and lets them play, for testing without gathering friends.
 *   bun scripts/bots.ts <base-url> <room> [count] [--start]
 * With --start the first bot is host and starts once everyone is seated; otherwise the bots
 * join an existing lobby and wait for a human host. Bots buy what they can afford and keep
 * S/200 in reserve, roll, end turns, accept no trades, and raise money or go bankrupt in debt.
 */
import { type Action, debtors, findPlayer, type PublicState } from "../shared/game.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";

const [base = "http://localhost:8791", room = "", countArg = "3"] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));
const autoStart = process.argv.includes("--start");
const count = Number(countArg);
if (!room) throw new Error("Usage: bun scripts/bots.ts <base-url> <room> [count] [--start]");

const names = ["Bot Chabuca", "Bot Grau", "Bot Tula", "Bot Micaela", "Bot Arguedas", "Bot Vallejo", "Bot Susana"];
const token = () => crypto.randomUUID().replaceAll("-", "");

function decide(state: PublicState, me: string): Action | null {
  const p = findPlayer(state, me);
  if (!p || p.bankrupt || state.phase !== "playing") return null;
  if (p.cash < 0) {
    const sellable = state.props.findIndex((x) => x?.owner === me && x.houses > 0);
    if (sellable !== -1) return { type: "sell", square: sellable };
    const mortgageable = state.props.findIndex((x) => x?.owner === me && !x.mortgaged);
    return mortgageable !== -1 ? { type: "mortgage", square: mortgageable } : { type: "bankrupt" };
  }
  if (debtors(state).length > 0 || state.turn?.playerId !== me) return null;
  switch (state.turn.stage) {
    case "roll":
      return { type: "roll" };
    case "buy":
      return p.cash > 260 ? { type: "buy" } : { type: "decline" };
    case "done":
      return { type: "endTurn" };
  }
}

const url = `${base.replace(/^http/, "ws")}/ws/${room}`;
for (let n = 0; n < count; n++) {
  setTimeout(() => {
    const ws = new WebSocket(`${url}?token=${token()}`);
    const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg));
    let pending: ReturnType<typeof setTimeout> | undefined;
    ws.addEventListener("open", () => send({ type: "join", name: names[n] ?? `Bot ${n}` }));
    ws.addEventListener("message", (event) => {
      if (event.data === "pong") return;
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      if (msg.type === "error") return console.log(`[${names[n]}] error: ${msg.message}`);
      const { state, you } = msg;
      if (!you) return;
      if (autoStart && state.phase === "lobby" && state.hostId === you && state.players.length >= count) {
        return send({ type: "action", action: { type: "start" } });
      }
      if (state.phase === "ended") {
        console.log(`[${names[n]}] game over, winner: ${findPlayer(state, state.winnerId)?.name}`);
        return ws.close();
      }
      clearTimeout(pending);
      const action = decide(state, you);
      if (action) pending = setTimeout(() => send({ type: "action", action }), 700);
    });
    ws.addEventListener("close", () => console.log(`[${names[n]}] disconnected`));
  }, n * 300);
}
