import { DurableObject } from "cloudflare:workers";

import type { GameRecord, RankingPeriod, RankingResponse } from "../shared/leaderboard.ts";
import { LeaderboardStore } from "./leaderboardStore.ts";

/** Keeps every finished game's results and ranks players from them. One instance serves everyone. */
export class Leaderboard extends DurableObject<Env> {
  private readonly store: LeaderboardStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new LeaderboardStore(ctx.storage.sql);
  }

  record(game: GameRecord): boolean {
    return this.ctx.storage.transactionSync(() => this.store.record(game));
  }

  ranking(period: RankingPeriod, you: string | null): RankingResponse {
    return this.store.ranking(period, Date.now(), you);
  }
}
