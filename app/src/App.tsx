import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { DICE_HOLD_EXPIRE_MS, type DiceToss } from "../../shared/dice.ts";
import { canDragDice } from "../../shared/game.ts";
import { BoardScene } from "./scene/BoardScene.ts";
import { createRoom, findOpenRoom, goToRoom, roomFromPath, saveName } from "./session.ts";
import { Deed } from "./ui/Deed.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Lobby } from "./ui/Lobby.tsx";
import { NameGate } from "./ui/NameGate.tsx";
import { useTable } from "./useTable.ts";

/** How long a throw may wait for the server before the dice go back. */
const ROLL_TIMEOUT_MS = 4000;

interface Seat {
  room: string;
  name: string;
}

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<BoardScene | null>(null);
  const [no3d, setNo3d] = useState(false);
  const [room, setRoom] = useState(roomFromPath);
  const [seat, setSeat] = useState<Seat | null>(null);

  useEffect(() => {
    if (!host.current) return;
    let s: BoardScene;
    try {
      s = new BoardScene(host.current);
    } catch (error) {
      // No WebGL (disabled, blocklisted GPU): the game still works from the panels.
      console.error(error);
      setNo3d(true);
      return;
    }
    setScene(s);
    return () => s.dispose();
  }, []);

  useEffect(() => {
    const onPop = () => {
      setRoom(roomFromPath());
      setSeat(null);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const sit = (next: string, name: string) => {
    if (roomFromPath() !== next) goToRoom(next);
    setRoom(next);
    setSeat({ room: next, name });
  };

  const enter = async (name: string, code: string | null) => {
    saveName(name);
    sit(code ?? (await findOpenRoom()), name);
  };

  const create = async (name: string) => {
    saveName(name);
    sit(await createRoom(), name);
  };

  const newRoom = async () => {
    if (seat) sit(await createRoom(), seat.name);
  };

  const home = () => {
    goToRoom(null);
    setRoom(null);
    setSeat(null);
  };

  return (
    <>
      <div class="scene" ref={host} />
      {no3d && <p class="banner">Tu navegador no pudo mostrar el tablero 3D. Puedes jugar igual con los paneles.</p>}
      {seat ? (
        <TableView key={seat.room} seat={seat} scene={scene} onNewRoom={newRoom} onHome={home} />
      ) : (
        <NameGate room={room} onEnter={enter} onCreate={create} />
      )}
    </>
  );
}

interface TableProps {
  seat: Seat;
  scene: BoardScene | null;
  onNewRoom: () => void;
  onHome: () => void;
}

function TableView({ seat, scene, onNewRoom, onHome }: TableProps) {
  const table = useTable(seat.room, seat.name);
  const { state, status, error, diceHold, you, send } = table;
  const [inspect, setInspect] = useState<number | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const rollId = state?.rollId;
  const diceLanded = useCallback((id: number) => scene?.diceLanded(id) ?? true, [scene]);
  const turnKey = `${state?.turn?.playerId}:${state?.turn?.stage}`;

  useEffect(() => {
    scene?.update(state);
  }, [scene, state]);

  useEffect(() => {
    if (status === "reconnecting") scene?.snapNextUpdate();
  }, [scene, status]);

  useEffect(() => {
    scene?.onPick(setInspect);
    return () => {
      scene?.onPick(null);
      scene?.update(null);
    };
  }, [scene]);

  const roll = useCallback(
    (toss?: DiceToss) => {
      if (status !== "open" || !state || !canDragDice(state, you, state.rollId)) {
        scene?.cancelDice();
        return;
      }
      setRolling(true);
      send({ type: "action", action: { type: "roll", rollId: state.rollId, ...(toss ? { diceToss: toss } : {}) } });
    },
    [scene, send, state, status, you],
  );

  useEffect(() => {
    scene?.onDiceInput({
      onRoll: roll,
      onHold: (hold) => {
        setShaking(hold ? you : null);
        if (status === "open" && state) send({ type: "diceHold", rollId: state.rollId, hold });
      },
    });
  }, [scene, send, roll, state, status, you]);

  useEffect(() => () => scene?.onDiceInput(null), [scene]);

  useEffect(() => {
    scene?.setDiceEnabled(Boolean(status === "open" && !rolling && state && canDragDice(state, you, state.rollId)));
  }, [scene, state, status, you, rolling]);

  useEffect(() => {
    if (
      !diceHold ||
      diceHold.playerId === you ||
      !state ||
      status !== "open" ||
      !canDragDice(state, diceHold.playerId, diceHold.rollId)
    )
      return;
    setShaking(diceHold.hold ? diceHold.playerId : null);
    scene?.showDiceHold(diceHold.hold);
    const id = setTimeout(() => setShaking(null), DICE_HOLD_EXPIRE_MS);
    return () => clearTimeout(id);
  }, [scene, diceHold, you, state, status]);

  useEffect(() => {
    setShaking(null);
    setRolling(false);
  }, [rollId, turnKey]);

  useEffect(() => {
    if (!rolling) return;
    // A throw hovers mid-flight until the server's values arrive; never forever.
    const id = setTimeout(() => {
      scene?.cancelDice();
      setRolling(false);
      setShaking(null);
      setToast({ id: Date.now(), message: "La mesa no respondió. Vuelve a tirar." });
    }, ROLL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [scene, rolling]);

  useEffect(() => {
    if (!error && status === "open") return;
    scene?.cancelDice();
    setShaking(null);
    setRolling(false);
    if (error) setToast(error);
  }, [error, status, scene]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const leave = () => {
    send({ type: "leave" });
    onHome();
  };

  return (
    <>
      {!state && <p class="connecting">Conectando con la mesa…</p>}
      {state?.phase === "lobby" && <Lobby table={table} room={seat.room} onLeave={leave} onNewRoom={onNewRoom} />}
      {state && state.phase !== "lobby" && (
        <Hud
          table={table}
          onInspect={setInspect}
          onNewRoom={onNewRoom}
          onHome={onHome}
          onResetCamera={scene ? () => scene.resetCamera() : undefined}
          shaking={shaking}
          onRoll={() => scene?.throwDice() || roll()}
          rolling={rolling || status !== "open" || shaking === you}
          diceLanded={diceLanded}
        />
      )}
      {state && inspect !== null && <Deed state={state} index={inspect} onClose={() => setInspect(null)} />}
      {status === "reconnecting" && <p class="banner">Se cortó la conexión. Reconectando…</p>}
      {toast && (
        <p class="toast" role="alert">
          {toast.message}
        </p>
      )}
    </>
  );
}
