import "./ranking.css";
import { useEffect, useState } from "preact/hooks";

import type { PublicState } from "../../../shared/game.ts";
import {
  countsForRanking,
  finalPlacement,
  RANKING_SIZE,
  type RankingPeriod,
  type RankingResponse,
  type RankRow,
  SCORING_RULE,
  scoreGame,
} from "../../../shared/leaderboard.ts";
import { fetchRanking } from "../session.ts";
import { Pawn } from "./bits.tsx";

const PERIODS: { id: RankingPeriod; label: string }[] = [
  { id: "week", label: "Esta semana" },
  { id: "all", label: "Histórico" },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The leaderboard, opened from the home screen: this week (Lima, Monday to Sunday) or all time. */
export function RankingSheet({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<RankingPeriod>("week");
  const [data, setData] = useState<Partial<Record<RankingPeriod, RankingResponse>>>({});
  const [error, setError] = useState<string | null>(null);
  const shown = data[period];

  useEffect(() => {
    let live = true;
    setError(null);
    fetchRanking(period)
      .then((r) => live && setData((d) => ({ ...d, [period]: r })))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [period]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const youOutside = shown?.you && shown.you.rank > RANKING_SIZE ? shown.you : null;

  return (
    <aside class="sheet ranking-sheet" aria-labelledby="ranking-title">
      <header class="sheet-head">
        <h2 id="ranking-title">Ranking</h2>
        <button type="button" class="link" onClick={onClose}>
          Cerrar
        </button>
      </header>
      <div class="ranking-tabs" role="tablist" aria-label="Periodo">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === period}
            class={p.id === period ? "primary" : undefined}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p class="muted small">
        {SCORING_RULE} {period === "week" && "La semana va de lunes a domingo, hora de Lima."}
      </p>
      {error && (
        <p role="alert" class="form-error">
          {error}
        </p>
      )}
      {!shown && !error && <p class="muted">Contando puntos…</p>}
      {shown && shown.rows.length === 0 && (
        <p class="muted">
          {period === "week"
            ? "Nadie ha sumado puntos esta semana. ¡Arma una mesa y estrena el ranking!"
            : "Todavía no hay partidas en el ranking. ¡Sé el primero!"}
        </p>
      )}
      {shown && shown.rows.length > 0 && (
        <ol class="leaderboard">
          {shown.rows.map((row) => (
            <Row key={row.rank} row={row} you={row.rank === shown.you?.rank} />
          ))}
          {youOutside && (
            <>
              <li class="leaderboard-gap" aria-hidden="true">
                ⋯
              </li>
              <Row row={youOutside} you />
            </>
          )}
        </ol>
      )}
      {shown && !shown.you && shown.rows.length > 0 && (
        <p class="muted small">
          {period === "week" ? "Aún no sumas puntos esta semana." : "Aún no sumas puntos."} Termina una partida con otra
          persona para entrar.
        </p>
      )}
      <p class="muted small ranking-note">
        Tus puntos se guardan en este navegador: si borras sus datos o juegas desde otro equipo, empiezas de cero.
      </p>
    </aside>
  );
}

function Row({ row, you }: { row: RankRow; you: boolean }) {
  return (
    <li class={you ? "you" : undefined}>
      <span class="leaderboard-rank">{row.rank}</span>
      <span class="leaderboard-who">
        <span class="leaderboard-name">
          {row.name}
          {you && <span class="muted"> (tú)</span>}
        </span>
        <span class="muted small">
          {plural(row.games, "partida", "partidas")} · {plural(row.wins, "ganada", "ganadas")}
        </span>
      </span>
      <span class="leaderboard-points">{plural(row.points, "pt", "pts")}</span>
    </li>
  );
}

/** On the end screen: what each person earned this game, and your place in this week's ranking. */
export function GamePoints({ state, you }: { state: PublicState; you: string | null }) {
  /** Undefined while loading; null when the ranking doesn't have you yet. */
  const [rank, setRank] = useState<RankRow | null | "error" | undefined>(undefined);
  const scored = scoreGame(finalPlacement(state));
  const playing = scored.some((s) => s.player.id === you);

  useEffect(() => {
    if (!playing) return;
    let live = true;
    fetchRanking("week", true)
      .then((r) => live && setRank(r.you))
      .catch(() => live && setRank("error"));
    return () => {
      live = false;
    };
  }, [playing]);

  if (state.startedAt === null) return null;
  if (!countsForRanking(state)) {
    return (
      <p class="game-points muted small">
        Esta partida no suma al ranking: hacen falta al menos 2 personas, y los bots no cuentan.
      </p>
    );
  }
  return (
    <section class="game-points" aria-label="Puntos de la partida">
      <ol>
        {scored.map(({ player, points }) => (
          <li key={player.id}>
            <Pawn player={player} size={12} />
            <span class="game-points-name">
              {player.name}
              {player.id === you && <span class="muted"> (tú)</span>}
            </span>
            <span class="game-points-earned">+{plural(points, "pt", "pts")}</span>
          </li>
        ))}
      </ol>
      {playing && (
        <p class="small muted">
          {rank === undefined
            ? "Sumando tus puntos…"
            : rank === "error"
              ? "No pudimos ver tu puesto ahora. Míralo en el ranking del inicio."
              : rank === null
                ? "Tus puntos aún no aparecen. Míralos en un ratito en el ranking del inicio."
                : `Vas #${rank.rank} de la semana con ${plural(rank.points, "punto", "puntos")}.`}
        </p>
      )}
    </section>
  );
}
