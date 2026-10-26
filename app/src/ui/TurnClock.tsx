import "./turnClock.css";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { awaited, turnLimit } from "../../../shared/clock.ts";
import { debtors, type PublicState } from "../../../shared/game.ts";
import { playChime, playTick } from "../audio.ts";
import { useNow } from "./bits.tsx";

type Level = "calm" | "soon" | "warn" | "urgent";

interface Countdown {
  seconds: number;
  /** How much of the turn is left, 1 → 0. */
  fraction: number;
  level: Level;
}

const levelAt = (seconds: number): Level =>
  seconds <= 5 ? "urgent" : seconds <= 15 ? "warn" : seconds <= 20 ? "soon" : "calm";

const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function useCountdown(state: PublicState, now: () => number, active = true): Countdown | null {
  const deadline = active && state.phase === "playing" ? state.deadline : null;
  const time = useNow(deadline !== null, 250, now);
  if (deadline === null) return null;
  const total = turnLimit(state);
  const left = Math.max(0, Math.min(total, deadline - time));
  const seconds = Math.ceil(left / 1000);
  return { seconds, fraction: left / total, level: levelAt(seconds) };
}

const RADIUS = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ fraction }: { fraction: number }) {
  return (
    <svg class="turn-ring-svg" viewBox="0 0 36 36" aria-hidden="true">
      <circle class="turn-ring-track" cx="18" cy="18" r={RADIUS} />
      <circle
        class="turn-ring-fill"
        cx="18"
        cy="18"
        r={RADIUS}
        stroke-dasharray={CIRCUMFERENCE}
        style={{ strokeDashoffset: String(CIRCUMFERENCE * (1 - fraction)) }}
      />
    </svg>
  );
}

interface ClockProps {
  state: PublicState;
  you: string | null;
  now: () => number;
}

/** The turn countdown for whoever the table is waiting on; the large form when that is you. */
export function TurnClock({ state, you, now }: ClockProps) {
  const countdown = useCountdown(state, now);
  const waiting = awaited(state);
  const yours = waiting.some((p) => p.id === you);
  const seconds = countdown?.seconds ?? null;

  useEffect(() => {
    if (!yours || seconds === null || seconds <= 0 || seconds > 5) return;
    playTick();
    if (seconds === 5 && "vibrate" in navigator) navigator.vibrate([120, 80, 120]);
  }, [yours, seconds]);

  if (!countdown || waiting.length === 0) return null;
  const time = clockText(countdown.seconds);
  const owing = debtors(state).length > 0;

  if (yours) {
    return (
      <div class={`turn-clock mine ${countdown.level}`} role="timer">
        <Ring fraction={countdown.fraction} />
        <span class="turn-clock-text">
          {owing ? "Paga tu deuda" : "Tu turno"} · <span class="turn-clock-time">{time}</span>
        </span>
      </div>
    );
  }
  const names = waiting.map((p) => p.name).join(" y ");
  const label = waiting.every((p) => !p.connected)
    ? `Esperando a ${names} (sin conexión)`
    : owing
      ? `Esperando a ${names}`
      : `Juega ${names}`;
  return (
    <div class={`turn-clock ${countdown.level}`} role="timer">
      <Ring fraction={countdown.fraction} />
      <span class="turn-clock-text">
        {label} · <span class="turn-clock-time">{time}</span>
      </span>
    </div>
  );
}

export function TurnRing({
  state,
  playerId,
  now,
  children,
}: {
  state: PublicState;
  playerId: string;
  now: () => number;
  children: ComponentChildren;
}) {
  const countdown = useCountdown(
    state,
    now,
    awaited(state).some((p) => p.id === playerId),
  );
  return (
    <span class={countdown ? `turn-ring ${countdown.level}` : "turn-ring"}>
      {children}
      {countdown && <Ring fraction={countdown.fraction} />}
    </span>
  );
}

const BANNER_MS = 1500;

export function TurnBanner({ state, you }: { state: PublicState; you: string | null }) {
  const yourTurn = state.phase === "playing" && state.turn?.playerId === you;
  const [was, setWas] = useState(false);
  const [banner, setBanner] = useState(0);
  const [open, setOpen] = useState(false);
  if (yourTurn !== was) {
    setWas(yourTurn);
    if (yourTurn) {
      setBanner(banner + 1);
      setOpen(true);
    }
  }
  useEffect(() => {
    if (!banner) return;
    playChime();
    const id = setTimeout(() => setOpen(false), BANNER_MS);
    return () => clearTimeout(id);
  }, [banner]);
  if (!open) return null;
  return (
    <output key={banner} class="turn-banner">
      ¡Tu turno!
    </output>
  );
}

const ALERT_TITLE = "⏰ ¡Tu turno!";
const BADGE =
  '<svg viewBox="0 0 32 32" width="100%" height="100%"><circle cx="24" cy="8" r="7.5" fill="#ff5a5f" stroke="#1b1240" stroke-width="2.5"/></svg>';

let badged: Promise<string | null> | undefined;

function badgedIcon(href: string): Promise<string | null> {
  badged ??= fetch(href)
    .then((res) => (res.ok ? res.text() : ""))
    .then((svg) => {
      if (!/<\/svg>\s*$/.test(svg)) return null;
      return `data:image/svg+xml,${encodeURIComponent(svg.replace(/<\/svg>\s*$/, `${BADGE}</svg>`))}`;
    })
    .catch(() => null);
  return badged;
}

/** While the table waits on you in a background tab, blinks the title and badges the favicon; both revert when the tab is shown or the wait ends. */
export function useTurnAttention(state: PublicState | null, you: string | null): void {
  const yours = state?.phase === "playing" && awaited(state).some((p) => p.id === you);
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!yours || !hidden) return;
    const title = document.title;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const href = icon?.getAttribute("href");
    let stopped = false;
    if (icon && href) {
      void badgedIcon(icon.href).then((url) => {
        if (url && !stopped) icon.href = url;
      });
    }
    let alert = true;
    document.title = ALERT_TITLE;
    const id = setInterval(() => {
      alert = !alert;
      document.title = alert ? ALERT_TITLE : title;
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
      document.title = title;
      if (icon && href) icon.setAttribute("href", href);
    };
  }, [yours, hidden]);
}
