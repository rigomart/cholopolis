/** What each player did over one game, for the end-of-game postcard. */
export interface PlayerStats {
  rentPaid: number;
  rentReceived: number;
  /** Rent paid, by square index. */
  rentPaidAt: Record<number, number>;
  /** Rent collected, by square index. */
  rentReceivedAt: Record<number, number>;
  /** Times sent to the Penal. */
  jailed: number;
  /** Times past Salida. */
  laps: number;
  doubles: number;
  purchases: number;
  /** Houses and hotels put up. */
  built: number;
  /** Taxes, fines and cards paid to the bank. */
  paidToBank: number;
  biggestPayment: number;
  /** Players whose bankruptcy handed their properties to this one. */
  knockouts: number;
}

/** By player id. */
export type GameStats = Record<string, PlayerStats>;

export function statsOf(stats: GameStats, playerId: string): PlayerStats {
  stats[playerId] ??= {
    rentPaid: 0,
    rentReceived: 0,
    rentPaidAt: {},
    rentReceivedAt: {},
    jailed: 0,
    laps: 0,
    doubles: 0,
    purchases: 0,
    built: 0,
    paidToBank: 0,
    biggestPayment: 0,
    knockouts: 0,
  };
  return stats[playerId];
}

export function recordRent(stats: GameStats, payer: string, owner: string, square: number, amount: number): void {
  if (amount <= 0) return;
  const paid = statsOf(stats, payer);
  const got = statsOf(stats, owner);
  paid.rentPaid += amount;
  paid.rentPaidAt[square] = (paid.rentPaidAt[square] ?? 0) + amount;
  got.rentReceived += amount;
  got.rentReceivedAt[square] = (got.rentReceivedAt[square] ?? 0) + amount;
}

export function recordPayment(stats: GameStats, payer: string, amount: number, toBank: boolean): void {
  const s = statsOf(stats, payer);
  s.biggestPayment = Math.max(s.biggestPayment, amount);
  if (toBank) s.paidToBank += amount;
}
