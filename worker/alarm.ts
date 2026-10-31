/** An abandoned table forgets everything after this long. */
export const EXPIRE_MS = 24 * 60 * 60_000;
export const BOT_DELAY_MS = 1_000;
const ON_TIME_TOLERANCE_MS = 250;

/** What a table's single alarm can be waiting for. */
export interface AlarmInputs {
  /** Open sockets, players and spectators alike. */
  sockets: number;
  /** When the turn clock runs out, or null when nobody is on the clock. */
  deadline: number | null;
  /** When the next bot move is due, or null when no bot has anything to do. */
  botAt: number | null;
  now: number;
}

export type AlarmTask = "expire" | "bot" | "clock" | "wait";

/**
 * When the alarm should next ring, or null for no alarm. With nobody watching the table only
 * counts down to expiry: bots don't play to an empty room.
 */
export function nextAlarm({ sockets, deadline, botAt, now }: AlarmInputs): number | null {
  if (sockets === 0) return now + EXPIRE_MS;
  const due = [deadline, botAt].filter((t) => t !== null);
  return due.length > 0 ? Math.min(...due) : null;
}

/** What a ringing alarm should do; a due bot move goes before a due clock. */
export function alarmTask({ sockets, deadline, botAt, now }: AlarmInputs): AlarmTask {
  if (sockets === 0) return "expire";
  if (botAt !== null && now >= botAt - ON_TIME_TOLERANCE_MS) return "bot";
  if (deadline !== null && now >= deadline - ON_TIME_TOLERANCE_MS) return "clock";
  return "wait";
}

/**
 * Keeps a pending bot move's time, starts one for a new move, or clears it when there is none. A
 * time long past (the move waited out an empty table) starts over, so bots don't jump the first
 * person back.
 */
export function nextBotAt(pending: boolean, botAt: number | null, now: number): number | null {
  if (!pending) return null;
  return botAt !== null && botAt > now - BOT_DELAY_MS ? botAt : now + BOT_DELAY_MS;
}
