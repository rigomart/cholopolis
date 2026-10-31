import { findPlayer, mainCreditor, type Player, type PublicState } from "../../../shared/game.ts";

/** Money that changed hands; a null end is the bank. */
export interface Flow {
  from: string | null;
  to: string | null;
  amount: number;
}

/**
 * The money that moved between two consecutive states, in the order it moved.
 *
 * Cash differences are the truth. New log entries say who paid whom ("A pagó S/50 a B", passing
 * Salida), vanished trades and bankruptcies pair players up, and whatever is left over was settled
 * with the bank. Updates that arrive batched just yield more flows.
 */
export function flowsBetween(prev: PublicState, next: PublicState): Flow[] {
  const flows: Flow[] = [];
  const unexplained = new Map<string, number>();
  for (const p of next.players) {
    const before = findPlayer(prev, p.id);
    if (!before) continue;
    const wipedDebt = p.bankrupt && !before.bankrupt && p.cash > before.cash;
    if (wipedDebt) continue;
    unexplained.set(p.id, p.cash - before.cash);
  }
  const settle = (id: string | null, by: number) => {
    const change = id === null ? undefined : unexplained.get(id);
    if (id !== null && change !== undefined) unexplained.set(id, change + by);
  };
  const move = (from: string | null, to: string | null, amount: number) => {
    if (amount <= 0 || from === to) return;
    flows.push({ from, to, amount });
    settle(from, amount);
    settle(to, -amount);
  };

  const known = (id: string | null) => id === null || unexplained.has(id);
  const seen = prev.log.at(-1)?.id ?? 0;
  const named = next.players.toSorted((a, b) => b.name.length - a.name.length);
  for (const entry of next.log) {
    if (entry.id <= seen) continue;
    const flow = parseFlow(entry.text, named, (id) => unexplained.get(id) ?? 0);
    if (flow && known(flow.from) && known(flow.to)) move(flow.from, flow.to, flow.amount);
  }

  for (const t of prev.trades) {
    if (next.trades.some((x) => x.id === t.id)) continue;
    const toFrom = t.get.cash - t.give.cash;
    if (toFrom !== 0 && unexplained.get(t.from) === toFrom && unexplained.get(t.to) === -toFrom) {
      if (toFrom > 0) move(t.to, t.from, toFrom);
      else move(t.from, t.to, -toFrom);
    }
  }

  for (const p of next.players) {
    const before = findPlayer(prev, p.id);
    const creditor = before ? mainCreditor(before) : null;
    if (!p.bankrupt || before?.bankrupt !== false || !creditor) continue;
    const heir = findPlayer(next, creditor);
    const gain = heir ? (unexplained.get(heir.id) ?? 0) : 0;
    if (heir && gain > 0) move(p.id, heir.id, gain);
  }

  for (const [id, change] of unexplained) {
    if (change > 0) move(null, id, change);
    else if (change < 0) move(id, null, -change);
  }
  return flows;
}

/** The money that moved along a run of consecutive states, diffed pair by pair. */
export function flowsAlong(states: PublicState[]): Flow[] {
  return states.slice(1).flatMap((next, i) => {
    const prev = states[i];
    return prev ? flowsBetween(prev, next) : [];
  });
}

/**
 * `prev` with only the first Salida bonus in `next` paid, so the HUD can show it as the pawn walks
 * past Salida, before whatever happens where it lands. Null if nobody passed Salida.
 */
export function throughSalida(prev: PublicState, next: PublicState): PublicState | null {
  const seen = prev.log.at(-1)?.id ?? 0;
  const named = next.players.toSorted((a, b) => b.name.length - a.name.length);
  for (const entry of next.log) {
    if (entry.id <= seen) continue;
    const flow = parseFlow(entry.text, named);
    if (!flow || flow.from !== null || !findPlayer(prev, flow.to)) continue;
    return {
      ...prev,
      players: prev.players.map((p) => (p.id === flow.to ? { ...p, cash: p.cash + flow.amount } : p)),
      log: next.log.filter((e) => e.id <= entry.id),
    };
  }
  return null;
}

/**
 * Reads a payment or a Salida bonus out of a log line; `players` longest name first. `gained` is a
 * player's cash change not yet explained, to tell "a el banco" from a player named "el banco…".
 */
function parseFlow(text: string, players: Player[], gained: (id: string) => number = () => 0): Flow | null {
  const payer = players.find((p) => text.startsWith(`${p.name} pagó S/`));
  if (payer) {
    const match = /^(\d[\d.,  ]*) a (.*)$/.exec(text.slice(payer.name.length + " pagó S/".length));
    if (!match) return null;
    const [, digits = "", rest = ""] = match;
    const paid = amount(digits);
    const player = players.find((p) => rest.startsWith(p.name) && /^[ .]/.test(rest.slice(p.name.length)));
    const bank = /^el banco[ .]/.test(rest);
    if (player && (!bank || gained(player.id) >= paid)) return { from: payer.id, to: player.id, amount: paid };
    return bank ? { from: payer.id, to: null, amount: paid } : null;
  }
  const passer = players.find((p) => text.startsWith(`${p.name} pasó por Salida y cobró S/`));
  if (passer) {
    const digits = text.slice(passer.name.length + " pasó por Salida y cobró S/".length);
    return { from: null, to: passer.id, amount: amount(digits) };
  }
  return null;
}

const amount = (formatted: string) => Number(formatted.replace(/\D/g, ""));
