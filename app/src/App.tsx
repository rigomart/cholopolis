import { useEffect, useRef, useState } from "preact/hooks";

import { BoardScene } from "./scene/BoardScene.ts";
import { createRoom, findOpenRoom, goToRoom, roomFromPath, saveName } from "./session.ts";
import { Deed } from "./ui/Deed.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Lobby } from "./ui/Lobby.tsx";
import { NameGate } from "./ui/NameGate.tsx";
import { useTable } from "./useTable.ts";

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

  const enter = async (name: string) => {
    saveName(name);
    sit(room ?? (await findOpenRoom()), name);
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
        <NameGate room={room} onEnter={enter} />
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
  const { state, status, error, shake, you, send } = table;
  const [inspect, setInspect] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  const rollId = state?.rollId;
  const turnKey = `${state?.turn?.playerId}:${state?.turn?.stage}`;

  useEffect(() => {
    scene?.update(state);
  }, [scene, state]);

  useEffect(() => {
    scene?.onPick(setInspect);
    return () => {
      scene?.onPick(null);
      scene?.update(null);
    };
  }, [scene]);

  // Another player shaking the dice, relayed live by the table.
  useEffect(() => {
    if (!shake || shake.playerId === you) return;
    setShaking(shake.on ? shake.playerId : null);
    scene?.setShaking(shake.on);
  }, [scene, shake, you]);

  // The roll landing, or the turn moving on, ends any shake. The scene stops its own animation.
  useEffect(() => {
    setShaking(null);
  }, [rollId, turnKey]);

  const onShake = (on: boolean) => {
    setShaking(on ? you : null);
    scene?.setShaking(on);
    send({ type: "shake", on });
  };

  useEffect(() => {
    if (!error) return;
    // A refused roll must not leave the dice rattling in the air.
    scene?.setShaking(false);
    setShaking(null);
    setToast(error.message);
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [error, scene]);

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
          shaking={shaking}
          onShake={onShake}
        />
      )}
      {state && inspect !== null && <Deed state={state} index={inspect} onClose={() => setInspect(null)} />}
      {status === "reconnecting" && <p class="banner">Se cortó la conexión. Reconectando…</p>}
      {toast && (
        <p class="toast" role="alert">
          {toast}
        </p>
      )}
    </>
  );
}
