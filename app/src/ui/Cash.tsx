import "./cash.css";
import type { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { money } from "../../../shared/game.ts";
import type { FlowBatch } from "../useShownState.ts";

const ROLL_MS = 600;
const FLY_MS = 700;
const STAGGER_MS = 110;
const FLOAT_MS = 1200;

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function useRolling(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const from = shownRef.current;
    if (from === target || prefersReducedMotion()) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / ROLL_MS);
      shownRef.current = Math.round(from + (target - from) * (1 - (1 - t) ** 3));
      setShown(shownRef.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

/** Rolls to each new balance; tagged `data-cash={id}` for `MoneyFlows`. */
export function RollingCash({ id, cash }: { id: string; cash: number }) {
  const shown = useRolling(cash);
  return (
    <span class={shown < 0 ? "player-cash negative" : "player-cash"} data-cash={id}>
      {money(shown)}
    </span>
  );
}

type Fx =
  | { kind: "chip"; key: number; x: number; y: number; dx: number; dy: number; delay: number; amount: number }
  | { kind: "float"; key: number; x: number; y: number; delay: number; change: number; stack: number }
  | { kind: "bank"; key: number; x: number; y: number; until: number };

/** Flying coins and +/− amounts for each batch in `batches` that arrives after mount, positioned from the rows of `list`. */
export function MoneyFlows({ batches, list }: { batches: FlowBatch[]; list: RefObject<HTMLElement | null> }) {
  const [fx, setFx] = useState<Fx[]>([]);
  const seenRef = useRef(batches.at(-1)?.id ?? -1);
  const keyRef = useRef(0);
  const remove = useCallback((key: number) => setFx((all) => all.filter((f) => f.key !== key)), []);

  useLayoutEffect(() => {
    const fresh = batches.filter((b) => b.id > seenRef.current);
    const box = list.current?.getBoundingClientRect();
    if (fresh.length === 0 || !list.current || !box) return;
    seenRef.current = fresh.at(-1)?.id ?? seenRef.current;
    const flows = fresh.flatMap((b) => b.flows);

    const cashEls = [...list.current.querySelectorAll<HTMLElement>("[data-cash]")];
    const bank = { x: box.left + 44, y: box.bottom + 20 };
    const cashBox = (id: string) => cashEls.find((el) => el.dataset.cash === id)?.getBoundingClientRect();
    const spot = (id: string | null) => {
      if (id === null) return bank;
      const r = cashBox(id);
      return r && { x: Math.min(Math.max(r.left + r.width / 2, box.left), box.right), y: r.top + r.height / 2 };
    };
    const still = prefersReducedMotion();
    const added: Fx[] = [];
    const totals = new Map<string, { out: number; in: number; landed: number }>();
    let bankUntil = 0;

    flows.forEach((f, i) => {
      const delay = still ? 0 : i * STAGGER_MS;
      const from = spot(f.from);
      const to = spot(f.to);
      if (!still && from && to) {
        added.push({
          kind: "chip",
          key: keyRef.current++,
          ...from,
          dx: to.x - from.x,
          dy: to.y - from.y,
          delay,
          amount: f.amount,
        });
        if (f.from === null || f.to === null) bankUntil = delay + FLY_MS;
      }
      for (const [id, sign] of [
        [f.from, -1],
        [f.to, 1],
      ] as const) {
        if (id === null) continue;
        const t = totals.get(id) ?? { out: 0, in: 0, landed: 0 };
        if (sign < 0) t.out += f.amount;
        else {
          t.in += f.amount;
          t.landed = still ? 0 : delay + FLY_MS;
        }
        totals.set(id, t);
      }
    });
    for (const [id, t] of totals) {
      const r = cashBox(id);
      if (!r || r.right < box.left || r.left > box.right) continue;
      const at = { x: r.right + 12, y: r.top + r.height / 2 };
      let stack = 0;
      if (t.out) added.push({ kind: "float", key: keyRef.current++, ...at, delay: 0, change: -t.out, stack: stack++ });
      if (t.in) added.push({ kind: "float", key: keyRef.current++, ...at, delay: t.landed, change: t.in, stack });
    }
    if (bankUntil) added.push({ kind: "bank", key: keyRef.current++, ...bank, until: bankUntil });
    setFx((all) => [...all, ...added]);
  }, [batches, list]);

  return (
    <div class="money-fx" aria-hidden="true">
      {fx.map((f) => (
        <Effect key={f.key} fx={f} onDone={remove} />
      ))}
    </div>
  );
}

function Effect({ fx, onDone }: { fx: Fx; onDone: (key: number) => void }) {
  const ms = fx.kind === "chip" ? fx.delay + FLY_MS : fx.kind === "float" ? fx.delay + FLOAT_MS : fx.until + 300;
  // Timed, not `animationend`: reduced motion turns the animations off.
  useEffect(() => {
    const id = setTimeout(() => onDone(fx.key), ms);
    return () => clearTimeout(id);
  }, [fx.key, ms, onDone]);

  const at = { left: `${fx.x}px`, top: `${fx.y}px` };
  if (fx.kind === "bank") {
    return (
      <span class="bank-spot" style={{ ...at, "--stay": `${fx.until}ms` }}>
        Banco
      </span>
    );
  }
  if (fx.kind === "float") {
    return (
      <span
        class={fx.change < 0 ? "cash-float loss" : "cash-float gain"}
        style={{ ...at, "--delay": `${fx.delay}ms`, "--stack": fx.stack }}
      >
        {fx.change < 0 ? `−${money(-fx.change)}` : `+${money(fx.change)}`}
      </span>
    );
  }
  return (
    <span
      class="coin-chip"
      style={{ ...at, "--dx": `${fx.dx}px`, "--dy": `${fx.dy}px`, "--delay": `${fx.delay}ms`, "--fly": `${FLY_MS}ms` }}
    >
      <span class="coin-chip-y">
        <span class="coin">{money(fx.amount)}</span>
      </span>
    </span>
  );
}
