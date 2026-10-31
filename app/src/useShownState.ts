import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type { PublicState } from "../../shared/game.ts";
import { prefersReducedMotion } from "./ui/Cash.tsx";
import { type Flow, flowsAlong, throughSalida } from "./ui/flows.ts";

const DICE_WAIT_MS = 4000;
const WALK_WAIT_MS = 4000;
/** Pawn timings in BoardScene: one hop per square, a jump to the Penal. */
const HOP_MS = 190;
const REDUCED_HOP_MS = 60;
const JUMP_MS = 700;
const POLL_MS = 100;
const KEPT_BATCHES = 20;

export interface FlowBatch {
  id: number;
  flows: Flow[];
}

export interface ShownState {
  state: PublicState | null;
  batches: FlowBatch[];
  settling: boolean;
}

interface Pending {
  state: PublicState;
  rollId: number | null;
  arrived: number;
  steps: { at: number; state: PublicState }[] | null;
}

function walkTimes(next: PublicState, start: number): { salida: number | null; land: number } {
  const hop = prefersReducedMotion() ? REDUCED_HOP_MS : HOP_MS;
  let t = start;
  let salida: number | null = null;
  for (const m of next.moves) {
    if (m.steps === null) {
      t += JUMP_MS;
      continue;
    }
    if (salida === null && m.steps > 0 && m.from + m.steps >= 40) salida = t + (40 - m.from) * hop;
    t += Math.abs(m.steps) * hop;
  }
  return { salida, land: Math.min(t, start + WALK_WAIT_MS) };
}

/**
 * The state the HUD shows: `state`, except that an update a roll caused waits until its dice land
 * and the pawn walks there, so no panel gives the roll away. Later updates queue behind it in
 * order; every wait is capped, so the real state always shows in the end. `batches` holds the
 * money each release moved, worked out state by state; `settling` is true while updates wait.
 */
export function useShownState(state: PublicState | null, diceLanded: (rollId: number) => boolean): ShownState {
  const [shown, setShown] = useState(state);
  const [batches, setBatches] = useState<FlowBatch[]>([]);
  const [waiting, setWaiting] = useState(false);
  const arrivedRef = useRef(state);
  const shownRef = useRef(state);
  const queueRef = useRef<Pending[]>([]);
  const batchIdRef = useRef(0);

  const release = useCallback(() => {
    const now = performance.now();
    const queue = queueRef.current;
    let last = shownRef.current;
    const path: PublicState[] = [];
    const reach = (s: PublicState) => {
      last = s;
      path.push(s);
    };
    while (queue[0]) {
      const head = queue[0];
      const overtaken = queue.some((p) => p !== head && p.rollId !== null);
      if (head.rollId !== null && !head.steps) {
        if (!diceLanded(head.rollId) && now - head.arrived < DICE_WAIT_MS && !overtaken) break;
        const walk = walkTimes(head.state, now);
        const salida = last && walk.salida !== null && walk.salida < walk.land ? throughSalida(last, head.state) : null;
        head.steps = [
          ...(salida && walk.salida !== null ? [{ at: walk.salida, state: salida }] : []),
          { at: walk.land, state: head.state },
        ];
      }
      if (!head.steps) reach(head.state);
      else {
        const due = overtaken ? head.steps.length : head.steps.filter((step) => step.at <= now).length;
        for (const step of head.steps.splice(0, due)) reach(step.state);
        if (head.steps.length > 0) break;
      }
      queue.shift();
    }
    const from = shownRef.current;
    if (last !== from) {
      shownRef.current = last;
      setShown(last);
      const flows = from ? flowsAlong([from, ...path]) : [];
      const id = batchIdRef.current++;
      if (flows.length > 0) setBatches((all) => [...all.slice(1 - KEPT_BATCHES), { id, flows }]);
    }
    setWaiting(queue.length > 0);
  }, [diceLanded]);

  useEffect(() => {
    const before = arrivedRef.current;
    if (!state || state === before) return;
    arrivedRef.current = state;
    const rolled = before !== null && state.rollId !== before.rollId;
    queueRef.current.push({ state, rollId: rolled ? state.rollId : null, arrived: performance.now(), steps: null });
    release();
  }, [state, release]);

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(release, POLL_MS);
    return () => clearInterval(id);
  }, [waiting, release]);

  return { state: shown ?? state, batches, settling: waiting };
}
